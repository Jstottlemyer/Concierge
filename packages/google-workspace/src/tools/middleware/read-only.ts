// Read-Only mode server-side rejection middleware — Wave 7 T17.
//
// Per plan.md Decision #12, Read-Only mode is a per-account flag persisted in
// state.json (`accounts[email].read_only`). When enabled, any tool that writes,
// deletes, or grants must be rejected server-side — we do NOT rely on
// `notifications/list_changed` to hide tools (the MCP protocol's hide-tools
// dance is advisory and client-specific). The server is the source of truth.
//
// Enforcement flow per invocation:
//   1. If `tool.readonly === true` (registry-level flag), always allow. No
//      state lookup needed — declared-safe tools skip the whole check.
//   2. If `tool.name === 'gws_execute'`, read the caller-asserted
//      `args.readonly: boolean` field. If true, treat the call as readonly and
//      allow. If false, fall through to the account-based check.
//   3. Resolve the effective account (args.account, else state.default_account).
//      If the account has `read_only === true`, reject with a `read_only_active`
//      envelope and a `next_call` pointing at `set_read_only({ enabled: false })`.
//      Otherwise allow.
//
// Design notes:
//   - The middleware wraps `invoke` only; every other field (name, description,
//     service, readonly, input, output) is preserved by-reference. A wrapped
//     tool is still a valid `ToolDef` / `AnyToolDef`.
//   - Idempotency: `enforceReadOnly` stamps `IS_WRAPPED_MARKER` on the returned
//     def via a non-enumerable symbol. `applyReadOnlyMiddleware` checks the
//     marker and leaves already-wrapped tools alone so repeated calls are
//     safe. The server bootstrap will call it exactly once in practice.
//   - Account resolution failure (no arg, no default) is NOT a middleware
//     rejection — we hand control to the underlying tool, which will produce
//     its own validation error. Rationale: the middleware's contract is
//     "enforce Read-Only if account is known"; it should not invent error
//     shapes for input-validation concerns that belong to the tool.
//   - `loadState()` reads from disk on every invocation. For v1 this is fine
//     (tools are low-frequency; state.json is ≤64 KiB). A per-request cache
//     would be a Wave 8 optimization if profiling shows it matters.

import { makeError } from '@concierge/core/errors';
import { loadState, normalizeEmail } from '../../state/loader.js';
import { replaceAllTools } from '../registry.js';
import type { AnyToolDef, ToolContext, ToolDef, ToolResult } from '../types.js';

/**
 * Marker stamped on wrapped tool defs so `applyReadOnlyMiddleware` can tell
 * already-wrapped tools from pristine ones. Symbol-keyed and non-enumerable
 * so it never leaks into schema serialization (MCP tools/list) or diffs.
 */
const IS_WRAPPED_MARKER = Symbol.for('concierge.readOnlyMiddleware.wrapped');

type WrappedMarker = {
  readonly [IS_WRAPPED_MARKER]?: true;
};

/**
 * Shape of `gws_execute` input fields we care about. The real schema is
 * defined in `passthrough/gws-execute.ts`; here we only look at `readonly`
 * and `account` (both required/optional as typed in the source schema).
 */
interface GwsExecuteArgsView {
  readonly readonly?: unknown;
  readonly account?: unknown;
}

/**
 * Shape of non-gws_execute tool args we care about. Tools that accept a
 * per-call `account` use this convention (see e.g. set_read_only, remove_account).
 */
interface AccountArgsView {
  readonly account?: unknown;
}

/**
 * Resolve the effective account for a tool call:
 *   1. `args.account` if provided and non-empty (normalized to lowercase).
 *   2. `state.default_account` otherwise.
 *   3. `null` if neither is available.
 *
 * Email normalization (lowercasing, trim) mirrors the loader so comparisons
 * against `state.accounts` keys are consistent.
 */
export async function resolveEffectiveAccount(
  args: AccountArgsView | undefined,
): Promise<string | null> {
  const raw = args?.account;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return normalizeEmail(raw);
  }
  const state = await loadState();
  return state.default_account;
}

/**
 * Build the canonical `read_only_active` rejection envelope.
 *
 * The message is user-facing (surfaced via Claude's conversation), so it
 * names both the account and the tool, and explains the remedy. `next_call`
 * is a structured hint the client can chain into — see plan.md Decision #4
 * for the envelope contract.
 */
function buildReadOnlyActiveError(email: string, toolName: string) {
  return makeError({
    error_code: 'read_only_active',
    message:
      `Read-Only mode is on for ${email}, so I can't run ${toolName} (it writes data). ` +
      `To allow writes, ask me to disable Read-Only for ${email}.`,
    next_call: {
      tool: 'set_read_only',
      arguments: { enabled: false, account: email },
    },
  });
}

/**
 * Check whether the given account is currently in Read-Only mode. Unknown
 * accounts are treated as NOT read-only (the underlying tool will surface
 * "account not connected" via its own validation path).
 */
async function accountIsReadOnly(email: string): Promise<boolean> {
  const state = await loadState();
  const entry = state.accounts[email];
  return entry?.read_only === true;
}

/**
 * Wrap a tool's `invoke` so Read-Only mode rejection applies. See module
 * header for the full enforcement flow.
 *
 * Generic-preserving: returns a `ToolDef<I, O>` with the same Input/Output.
 * Idempotent: passing an already-wrapped def returns it as-is.
 */
export function enforceReadOnly<I, O>(tool: ToolDef<I, O>): ToolDef<I, O> {
  // Short-circuit if already wrapped — supports calling the apply function
  // twice without double-wrapping.
  if ((tool as ToolDef<I, O> & WrappedMarker)[IS_WRAPPED_MARKER] === true) {
    return tool;
  }

  // Readonly-at-registration tools skip all state lookups. Still stamp the
  // wrapper marker so an outer `applyReadOnlyMiddleware` call treats them as
  // handled (no re-wrapping).
  if (tool.readonly === true) {
    const passThrough: ToolDef<I, O> = {
      name: tool.name,
      description: tool.description,
      service: tool.service,
      readonly: tool.readonly,
      input: tool.input,
      output: tool.output,
      invoke: tool.invoke,
    };
    Object.defineProperty(passThrough, IS_WRAPPED_MARKER, {
      value: true,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    return passThrough;
  }

  const wrappedInvoke = async (args: I, ctx: ToolContext): Promise<ToolResult<O>> => {
    // gws_execute carries a caller-asserted readonly boolean. If the caller
    // claims readonly, skip the state check entirely — the assertion is the
    // contract (argv-level enforcement happens in the underlying runner).
    if (tool.name === 'gws_execute') {
      const view = (args as unknown) as GwsExecuteArgsView;
      if (view.readonly === true) {
        return tool.invoke(args, ctx);
      }
      // Fall through to account-based check for readonly === false or
      // unexpected types (Zod already validated schema, but defense in depth).
      const email = await resolveEffectiveAccount(view as AccountArgsView);
      if (email === null) {
        // No account to gate on — let the underlying tool handle it; Read-Only
        // can't apply without an account.
        return tool.invoke(args, ctx);
      }
      if (await accountIsReadOnly(email)) {
        return { ok: false, error: buildReadOnlyActiveError(email, tool.name) };
      }
      return tool.invoke(args, ctx);
    }

    // Non-readonly tool, non-passthrough. Resolve account and gate.
    const view = (args as unknown) as AccountArgsView;
    const email = await resolveEffectiveAccount(view);
    if (email === null) {
      // See note in module header: we defer input validation to the tool.
      return tool.invoke(args, ctx);
    }
    if (await accountIsReadOnly(email)) {
      return { ok: false, error: buildReadOnlyActiveError(email, tool.name) };
    }
    return tool.invoke(args, ctx);
  };

  const wrapped: ToolDef<I, O> = {
    name: tool.name,
    description: tool.description,
    service: tool.service,
    readonly: tool.readonly,
    input: tool.input,
    output: tool.output,
    invoke: wrappedInvoke,
  };
  Object.defineProperty(wrapped, IS_WRAPPED_MARKER, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return wrapped;
}

/**
 * Apply Read-Only middleware to every tool in the registry in place.
 *
 * Idempotent: already-wrapped tools are left alone (marker check). Must be
 * called before `finalizeRegistry()` — after freeze the registry refuses
 * mutation. Intended call site is the Wave 8 MCP server bootstrap, which
 * wires the registry and then freezes it before emitting `tools/list`.
 *
 * Notably NOT called at module-import time, so unit tests that interact with
 * raw tool defs remain unaffected by the middleware.
 */
export function applyReadOnlyMiddleware(): void {
  replaceAllTools((def) => enforceReadOnly(def as unknown as ToolDef) as unknown as AnyToolDef);
}

/**
 * Test-only accessor: whether a tool def has been wrapped by this middleware.
 * Production code should not branch on this; it exists so the idempotency
 * test can assert that calling `applyReadOnlyMiddleware` twice does not
 * re-wrap (i.e., wrapped tool identity is preserved across the second call).
 */
export function __isWrappedForTests(tool: { readonly name: string }): boolean {
  return (tool as unknown as WrappedMarker)[IS_WRAPPED_MARKER] === true;
}
