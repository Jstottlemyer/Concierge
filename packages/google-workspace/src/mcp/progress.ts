// T8: MCP progress-notification helper for the auto-consent flow.
//
// Per spec.md §"First-run UX" and plan.md T8, when a tool call triggers an
// auto-OAuth flow, the server surfaces status updates to the client via
// MCP `notifications/progress`. Claude Desktop renders these inline with the
// long-running tool call so the user sees *why* the call is taking time.
//
// MCP protocol contract (per @modelcontextprotocol/sdk, notifications/progress):
//   - A client may opt into progress by including `_meta.progressToken` in its
//     original `tools/call` request.
//   - The server SHOULD then emit one or more `notifications/progress` with
//     `{ progressToken, progress, total?, message? }` until the call completes.
//   - If the client did NOT supply a token, the server MUST NOT emit notifications
//     (they'd be unroutable / noisy). In that case this helper becomes a noop.
//
// The auto-consent flow emits 5 normal stages + optionally 1 terminal failure.
// Numeric progress values and message copy live in sibling modules:
//   - `./progress-values.ts`   — { progress, total } per stage
//   - `./progress-messages.ts` — user-facing copy per stage
//
// This module exposes the minimal emitter interface callers need.

import { renderStageMessage } from './progress-messages.js';
import { PROGRESS_VALUES } from './progress-values.js';

/**
 * Discriminated set of stages in the auto-consent progress flow.
 *
 * Five normal stages (detecting → launching → awaiting → persisting → retrying)
 * plus one terminal-failure stage (consent denied / window closed). Non-consent
 * failures (e.g., network error) surface through the error envelope, not here.
 */
export type ProgressStage =
  | 'detecting_grant'
  | 'launching_browser'
  | 'awaiting_consent'
  | 'persisting_token'
  | 'retrying_call'
  | 'failed_consent_denied';

/**
 * Context fields interpolated into stage message templates.
 *
 * All optional — callers pass whatever they know at emit time. Missing fields
 * are substituted with a grammatical fallback by `renderStageMessage`.
 */
export interface ProgressContext {
  readonly account?: string;
  readonly bundleDisplay?: string;
  readonly scopeCount?: number;
  readonly tool?: string;
}

/**
 * Awaitable emitter the caller invokes at each stage boundary.
 *
 * Callers should `await` each emit so a slow transport doesn't interleave
 * stages, but they MAY fire-and-forget if stage ordering doesn't matter.
 * The emitter itself resolves once the underlying `send()` resolves (or
 * immediately if this is the noop variant).
 */
export type ProgressEmitter = (stage: ProgressStage, context: ProgressContext) => Promise<void>;

/**
 * Low-level send callback — the adapter between this helper and whichever
 * MCP transport/server object the caller holds. Typed loosely (`unknown`
 * params) on purpose: the helper owns the shape of the params object, so
 * the callback need only be a "send a JSON-RPC notification" function.
 */
export type SendNotification = (
  method: 'notifications/progress',
  params: unknown,
) => Promise<void>;

/**
 * Wire-shape for a single `notifications/progress` params object.
 *
 * The `progressToken` can be a string or number per MCP spec; we preserve
 * whatever the client originally supplied so the client can correlate the
 * notification back to its `tools/call` request.
 */
interface ProgressParams {
  readonly progressToken: string | number;
  readonly progress: number;
  readonly total: number;
  readonly message: string;
}

export interface CreateProgressEmitterParams {
  /** The client-supplied progress token from `_meta.progressToken`, if any. */
  readonly progressToken?: string | number;
  /** Transport-level notification sender. */
  readonly send: SendNotification;
}

/**
 * Noop emitter: returns immediately without sending any notification.
 *
 * Exported so callers that already know there's no progress token can
 * skip the factory call entirely and pass this around as a sentinel.
 */
export const noopProgressEmitter: ProgressEmitter = async (_stage, _ctx) => {
  // Intentional noop — `_stage` / `_ctx` unused. Resolves on next microtask.
  return;
};

/**
 * Build a `ProgressEmitter` bound to a specific `progressToken` + `send` pair.
 *
 * If the caller didn't receive a `progressToken` from the client (absent
 * `_meta.progressToken`), this returns `noopProgressEmitter` automatically
 * so call sites don't have to branch.
 *
 * The returned emitter:
 *   1. Looks up `{ progress, total }` from `PROGRESS_VALUES[stage]`
 *   2. Renders the user-visible copy via `renderStageMessage(stage, ctx)`
 *   3. Calls `send('notifications/progress', { progressToken, progress, total, message })`
 *
 * Errors from `send()` are allowed to propagate — progress is best-effort per
 * plan.md §Risks table, but surfacing a transport failure to the caller lets
 * the orchestration layer decide whether to keep emitting on a dead channel.
 */
export function createProgressEmitter(params: CreateProgressEmitterParams): ProgressEmitter {
  const { progressToken, send } = params;

  if (progressToken === undefined) {
    return noopProgressEmitter;
  }

  return async (stage, ctx) => {
    const { progress, total } = PROGRESS_VALUES[stage];
    const message = renderStageMessage(stage, ctx);
    const payload: ProgressParams = {
      progressToken,
      progress,
      total,
      message,
    };
    await send('notifications/progress', payload);
  };
}
