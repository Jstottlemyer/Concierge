// T10: helper that constructs the "auth already in progress" error envelope.
//
// Centralising the copy here keeps the message consistent across every call
// site that might deflect a concurrent OAuth flow (tool dispatcher, auto-
// consent wrapper, etc.). The envelope includes a `retry_after_ms` hint so
// the client can back off before the next attempt.

import type { ErrorEnvelope } from '@concierge/core/errors';
import { makeError } from '@concierge/core/errors';

/** Default back-off the client should respect before retrying. */
export const AUTH_IN_PROGRESS_RETRY_AFTER_MS = 5_000;

/** Human-facing message shown when a concurrent consent flow is detected. */
export const AUTH_IN_PROGRESS_MESSAGE =
  'Auth already in progress — complete the consent in the open browser tab, then retry.';

/**
 * Build the canonical `auth_in_progress` envelope. Prefer this helper over
 * calling `makeError` inline so the message + retry hint stay consistent.
 */
export function buildAuthInProgressError(): ErrorEnvelope {
  return makeError({
    error_code: 'auth_in_progress',
    message: AUTH_IN_PROGRESS_MESSAGE,
    retry_after_ms: AUTH_IN_PROGRESS_RETRY_AFTER_MS,
  });
}
