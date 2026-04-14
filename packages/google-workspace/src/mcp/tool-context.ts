// Builder for per-invocation ToolContext — Wave 10 T-server.
//
// Every MCP `tools/call` request builds a fresh ToolContext. Today the context
// surface is intentionally minimal (just `now`): the existing tools (vendor
// helpers, shims, passthrough, management) talk to `runGws`, `loadState`,
// `ensureBundleGranted`, and the progress emitter through direct imports, so
// we don't need to thread those through the context object itself.
//
// We still build a "capability bag" (ConciergeCapabilities) that exposes every
// collaborator the dispatcher might hand to future tool authors. Today it's
// consumed by dispatch.ts for its own error-envelope construction and by the
// server wiring for the progress emitter; tomorrow's tools can reach for it
// via the `ctx` parameter without a breaking signature change.
//
// Keeping the ToolContext itself narrow preserves the discipline that tools
// pull their dependencies from explicit imports, which keeps them
// unit-testable without constructing a full capability bag.

import { ensureBundleGranted } from '../auth/consent-flow.js';
import { defaultAuthInProgressProbe } from '../auth/pidfile-probe.js';
import { runGws } from '../gws/runner.js';
import { redact } from '../log/redact.js';
import { loadState, writeState } from '../state/loader.js';
import type { ToolContext } from '../tools/types.js';

import {
  createProgressEmitter,
  noopProgressEmitter,
  type ProgressEmitter,
  type SendNotification,
} from './progress.js';

/**
 * Capability bag passed alongside the narrow ToolContext. Holds every
 * collaborator the MCP server + dispatcher might hand a tool. All fields are
 * concrete function references — no DI framework, no async factories, no
 * hidden state. Construction is cheap.
 */
export interface ConciergeCapabilities {
  readonly runGws: typeof runGws;
  readonly loadState: typeof loadState;
  readonly writeState: typeof writeState;
  readonly ensureBundleGranted: typeof ensureBundleGranted;
  readonly authInProgressProbe: typeof defaultAuthInProgressProbe;
  readonly progress: ProgressEmitter;
  readonly redact: typeof redact;
}

/** Inputs for a single `buildToolContext` call. */
export interface BuildToolContextParams {
  /** Optional MCP progress token from the request's `_meta.progressToken`. */
  readonly progressToken?: string | number | undefined;
  /** Notification sender bound to the current request (from `extra.sendNotification`). */
  readonly sendNotification?: SendNotification | undefined;
  /** Test-only override for the clock. Production passes `undefined`. */
  readonly now?: string | undefined;
}

/** Result of `buildToolContext` — narrow `ToolContext` plus the capability bag. */
export interface BuiltToolContext {
  readonly ctx: ToolContext;
  readonly capabilities: ConciergeCapabilities;
}

/**
 * Build a fresh ToolContext + capability bag for a single `tools/call` request.
 *
 * If the client didn't supply a progress token we bind the capability bag to
 * the `noopProgressEmitter` — emits nothing, swallows nothing, returns
 * immediately. Same contract as `createProgressEmitter` when `progressToken`
 * is undefined, surfaced here so callers don't need to branch.
 */
export function buildToolContext(params: BuildToolContextParams = {}): BuiltToolContext {
  const now = params.now ?? new Date().toISOString();
  const ctx: ToolContext = { now };

  const progress: ProgressEmitter =
    params.progressToken !== undefined && params.sendNotification !== undefined
      ? createProgressEmitter({ progressToken: params.progressToken, send: params.sendNotification })
      : noopProgressEmitter;

  const capabilities: ConciergeCapabilities = {
    runGws,
    loadState,
    writeState,
    ensureBundleGranted,
    authInProgressProbe: defaultAuthInProgressProbe,
    progress,
    redact,
  };

  return { ctx, capabilities };
}
