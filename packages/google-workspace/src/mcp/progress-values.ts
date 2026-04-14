// T8: numeric progress values for the 6 auto-consent stages.
//
// Per MCP spec, `notifications/progress` carries `{ progress, total }` where
// `progress` is a monotonically increasing number in [0, total]. We use
// `total: 1` across all stages so the values read directly as percentages
// for any client that renders a progress bar.
//
// Values are chosen to convey proportional time-in-stage — the two
// user-driven waits (browser + consent) consume most of the bar, while
// persistence + retry resolve quickly at the end.
//
// Invariants (enforced by tests/mcp/progress-values.test.ts):
//   1. `progress` is strictly monotonically increasing across the 6 stages
//      in the order they appear below
//   2. `progress` ≤ `total` for every stage
//   3. `total === 1` for every stage
//   4. `failed_consent_denied` (terminal failure) reaches progress = 1.0

import type { ProgressStage } from './progress.js';

/**
 * Canonical progress values per stage.
 *
 * Ordering (insertion order of this object) is load-bearing: the
 * `progress-values.test.ts` monotonicity test walks the entries in order.
 */
export const PROGRESS_VALUES: Record<ProgressStage, { progress: number; total: number }> = {
  detecting_grant: { progress: 0.1, total: 1 },
  launching_browser: { progress: 0.25, total: 1 },
  awaiting_consent: { progress: 0.5, total: 1 },
  persisting_token: { progress: 0.8, total: 1 },
  retrying_call: { progress: 0.95, total: 1 },
  failed_consent_denied: { progress: 1.0, total: 1 },
} as const;
