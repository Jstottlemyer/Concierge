// T8: canonical stage-message templates for the auto-consent progress flow.
//
// Per spec.md §"First-run UX" and §"Growing into another bundle", MCP surfaces
// progress to Claude Desktop during auto-triggered OAuth consent. The design
// phase produced 5 normal stages + 1 terminal-failure stage; the exact copy
// is encoded here as the single source of truth.
//
// Interpolation uses simple `{placeholder}` tokens. We implement a small
// template function in-file rather than pulling a template library — the
// set of placeholders is closed (4 names) and this avoids a runtime dep
// for ~20 lines of string substitution.
//
// Missing-context fallback: if a placeholder's value is undefined, the
// template is rendered with a sensible default (e.g., "your account" for
// `{account}`) rather than leaking `{bundle_display}` literal into the
// user-visible string.

import type { ProgressContext, ProgressStage } from './progress.js';

/**
 * Template-substitution placeholders used inside stage message templates.
 * Keys match the `{snake_case}` tokens in the raw templates below.
 */
type PlaceholderKey = 'account' | 'bundle_display' | 'scope_count' | 'tool';

/**
 * Canonical raw templates per stage.
 *
 * These are the 5+1 strings handed over from the UX design phase
 * (see plan.md T8 brief + spec.md §First-run UX). Treat as frozen copy:
 * edits should go through a spec revision, not a casual refactor.
 */
const STAGE_TEMPLATES: Record<ProgressStage, string> = {
  detecting_grant: 'Checking Google access for {account}…',
  launching_browser:
    'Opening browser for Google consent ({bundle_display} bundle, {scope_count} scopes).',
  awaiting_consent: 'Waiting for you to approve in the browser…',
  persisting_token: 'Consent received — saving credentials to Keychain.',
  retrying_call: 'Done. Retrying {tool}…',
  failed_consent_denied: 'Consent was denied or the window was closed. Nothing was changed.',
} as const;

/**
 * Fallback values used when a `{placeholder}` is referenced in a template
 * but the corresponding `ProgressContext` field is undefined. Chosen to
 * produce grammatical, non-technical copy (no `{bundle_display}` leaking
 * into the user-visible output).
 */
const FALLBACKS: Record<PlaceholderKey, string> = {
  account: 'your account',
  bundle_display: 'the required',
  scope_count: 'the required',
  tool: 'the tool',
};

/**
 * Resolve a single `{placeholder}` against `ctx` + `FALLBACKS`.
 *
 * Separate from `renderStageMessage` so the mapping from snake_case token
 * to `ProgressContext` camelCase field is explicit and unit-testable.
 */
function resolvePlaceholder(key: PlaceholderKey, ctx: ProgressContext): string {
  switch (key) {
    case 'account':
      return ctx.account ?? FALLBACKS.account;
    case 'bundle_display':
      return ctx.bundleDisplay ?? FALLBACKS.bundle_display;
    case 'scope_count':
      return ctx.scopeCount !== undefined ? String(ctx.scopeCount) : FALLBACKS.scope_count;
    case 'tool':
      return ctx.tool ?? FALLBACKS.tool;
  }
}

/**
 * Minimal `{placeholder}` substitution.
 *
 * - Tokens: `/\{([a-z_]+)\}/g` — lowercase + underscores only
 * - Unknown tokens are left as-is (defensive: if a template is edited to
 *   reference an unlisted key, the literal `{foo}` surfaces in logs rather
 *   than silently evaluating to empty string, surfacing the bug faster).
 */
function interpolate(template: string, ctx: ProgressContext): string {
  return template.replace(/\{([a-z_]+)\}/g, (full, rawKey: string) => {
    // Narrow `rawKey` to `PlaceholderKey`; unknown keys pass through verbatim.
    if (rawKey === 'account' || rawKey === 'bundle_display' || rawKey === 'scope_count' || rawKey === 'tool') {
      return resolvePlaceholder(rawKey, ctx);
    }
    return full;
  });
}

/**
 * Render the canonical user-visible message for a given auto-consent stage,
 * interpolating any `{placeholders}` from the provided context.
 *
 * Missing `ctx` fields are substituted with a grammatical fallback; callers
 * should pass the richest context they have, but partial context never
 * produces a malformed message.
 */
export function renderStageMessage(stage: ProgressStage, ctx: ProgressContext): string {
  const template = STAGE_TEMPLATES[stage];
  return interpolate(template, ctx);
}
