// Tool registry types for Concierge.
//
// Wave 2 — T4. This file defines the ToolDef shape that every Concierge tool
// conforms to. The registry (registry.ts) holds ToolDef instances; the MCP
// emitter (mcp-schema.ts) converts them into the `tools/list` response shape.
//
// Design constraints:
// - Strict TS, `exactOptionalPropertyTypes: true`, `noUncheckedIndexedAccess: true`.
// - Zod v3 schemas (zod-to-json-schema targets v3; zod v4 ships a `zod/v3` compat
//   entry we consume here). Wave 5 tool authors import from `zod/v3` for the same
//   reason.
// - `invoke` is intentionally loose at T4 — Wave 3 (T7, T7.5) extends `ToolContext`
//   with the `gws` runner handle, confirmation validator, read-only state, and a
//   progress-notification emitter. Keep ToolContext minimal here so later waves
//   grow it without a breaking rewrite.
// - Tool descriptions follow Decision #13.5's 3-part pattern (what / when to use /
//   when NOT to use + routing hint). The mcp-schema emitter lints this.

import type { ZodType } from 'zod/v3';

import type { ErrorCode } from '@concierge/core/errors';

/**
 * The set of Google Workspace services Concierge can address.
 *
 * `workflow` is a composite service surfacing the `gws workflow_*` helpers; it
 * isn't a discrete Google API but behaves service-like for registry purposes
 * (per plan Decision #11.5 tool inventory).
 *
 * Per plan Decision #12, a tool's `readonly: boolean` attribute is separate
 * from `service` — Read-Only mode gates on the attribute, not service name.
 */
export type Service =
  | 'gmail'
  | 'drive'
  | 'calendar'
  | 'docs'
  | 'sheets'
  | 'tasks'
  | 'forms'
  | 'chat'
  | 'meet'
  | 'people'
  | 'admin-reports'
  | 'events'
  | 'modelarmor'
  | 'classroom'
  | 'slides'
  | 'script'
  | 'workflow';

/**
 * `management` — Concierge management tools (`list_accounts`, `factory_reset`,
 * etc.) that are Concierge-native, not a Google service.
 *
 * `passthrough` — the `gws_execute` escape-hatch tool (T13) that forwards
 * arbitrary argv to the `gws` binary.
 */
export type ToolServiceTag = Service | 'management' | 'passthrough';

/**
 * Canonical error-envelope shape, mirroring plan Decision #4. T5 produces
 * these via `makeError()`; Wave 2 T4 only needs the structural type so tools
 * can return `ToolResult<T>`. Keep fields optional-if-optional per the plan.
 */
export interface ToolError {
  /**
   * Canonical `ErrorCode` from `src/errors.ts` — the single source of truth
   * for the envelope's discriminator. Re-exporting here would duplicate the
   * enum literals (and drift); we import the union and alias it in-place.
   */
  readonly error_code: ErrorCode;
  readonly message: string;
  readonly gws_version?: string;
  readonly gws_stderr?: string;
  readonly gws_exit_code?: number;
  readonly confirmation_phrase?: string;
  readonly retry_after_ms?: number;
  readonly next_call?: { readonly tool: string; readonly arguments: Readonly<Record<string, unknown>> };
  readonly copyable_command?: string;
  readonly docs_url?: string;
}

/**
 * Discriminated union for tool invocation outcomes. Success carries typed
 * data; failure carries a ToolError envelope. No thrown exceptions cross the
 * tool boundary — the registry and dispatcher assume `invoke` never rejects
 * for handled error paths.
 */
export type ToolResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: ToolError };

/**
 * Minimal invocation context handed to every tool.
 *
 * Wave 3 extends this with:
 *   - `gws: GwsRunner` (T7 subprocess runner)
 *   - `validateConfirmation(phrase, operation): boolean` (T5 confirmation validator)
 *   - `readonly: { enabled: boolean; accounts: Record<string, boolean> }` (T17 middleware)
 *   - `progress: ProgressEmitter` (T8 notifications)
 *   - `state: StateHandle` (T2 state.json access)
 *
 * Kept intentionally empty-but-extensible at T4: tools only need to accept
 * `ctx: ToolContext` and later waves add capabilities without changing the
 * ToolDef type.
 */
export interface ToolContext {
  /**
   * ISO-8601 timestamp of the current invocation. Injected by the dispatcher
   * so tools (and tests) don't reach for wall clocks directly — supports
   * deterministic testing. More Context fields land in Wave 3.
   */
  readonly now: string;
}

/**
 * Tool definition — the single shape every Concierge tool (vendor helper,
 * shim, passthrough, management) conforms to.
 *
 * Generic parameters:
 *   - `Input`: the parsed input type, inferred from the Zod schema.
 *   - `Output`: the success-case data type, inferred from the output schema.
 *
 * Defaults are `unknown` so an untyped `ToolDef` remains usable for the
 * registry's heterogeneous array; call sites that know their types should
 * pass explicit generics for full inference.
 *
 * `readonly: true` marks the tool as safe while the account is in Read-Only
 * mode (plan Decision #12). Anything that writes, deletes, or grants must be
 * `false` — the T17 middleware rejects write tools when the account's
 * read_only flag is set.
 *
 * `description` must conform to Decision #13.5's 3-part pattern. The
 * `validateDescription` linter in `mcp-schema.ts` warns (v1) if it doesn't;
 * Wave 5 agents fix warnings as they add tools.
 */
export interface ToolDef<Input = unknown, Output = unknown> {
  /** Canonical tool name. Vendor helpers: short (`gmail_send`). Shims:
   *  `service_resource_verb` per plan Decision #2 (`drive_files_list`). */
  readonly name: string;

  /** User- and Claude-facing description. 3-part pattern per Decision #13.5:
   *  (1) imperative "what it does" first sentence, (2) "Use when ..." trigger
   *  phrase, (3) "For ..., prefer ..." routing hint when overlapping with
   *  claude.ai connectors. Linted at registration. */
  readonly description: string;

  /** Service tag — powers bundle routing and scope-gating, also used by
   *  metrics/logs. Composite `workflow` tag covers `gws workflow_*`. */
  readonly service: ToolServiceTag;

  /** If `true`, safe under Read-Only mode (Decision #12). Write/delete/grant
   *  tools must declare `false` so T17 can reject them server-side. */
  readonly readonly: boolean;

  /** Zod input schema (zod/v3). Emitted as JSON Schema for the MCP
   *  `tools/list` response. Keep top-level shape an object — MCP requires
   *  `inputSchema.type === 'object'`. */
  readonly input: ZodType<Input>;

  /** Zod output schema for the success-case `data`. Emitted as
   *  `outputSchema` in the MCP tool descriptor when present. */
  readonly output: ZodType<Output>;

  /** Invocation function. Returns a ToolResult instead of throwing on
   *  handled errors — unhandled throws bubble to the dispatcher's global
   *  error trap (T5). Wave 3 narrows this signature via ToolContext. */
  readonly invoke: (args: Input, ctx: ToolContext) => Promise<ToolResult<Output>>;
}

/**
 * Alias for the heterogeneous registry array.
 *
 * Implementation note: the invoke signature is contravariant in `Input`, so
 * `ToolDef<{a: string}>` is NOT assignable to `ToolDef<unknown>`. We mirror
 * the MCP SDK's own approach and model the registry-level alias with loose
 * invoke typing. Call sites with known input/output still use
 * `ToolDef<Input, Output>` directly for full inference; only the registry's
 * heterogeneous array needs this laxer shape.
 *
 * The loose type lives on `invoke` only — `input` and `output` keep their
 * typed schemas so the MCP emitter can still reflect them.
 */
export interface AnyToolDef extends Omit<ToolDef, 'invoke' | 'input' | 'output'> {
  readonly input: ZodType<unknown>;
  readonly output: ZodType<unknown>;
  // Loosely typed invoke so tools with concrete Input/Output can be stored in
  // a homogeneous array. Registration narrows via the generic `registerTool`
  // signature; dispatcher-level argument validation happens in Wave 3 via the
  // Zod `input` schema before invoke is called, so the runtime cast is sound.
  readonly invoke: (args: never, ctx: ToolContext) => Promise<ToolResult<unknown>>;
}
