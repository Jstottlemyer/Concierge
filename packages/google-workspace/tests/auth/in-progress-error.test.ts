// T10 companion: ensure the auth_in_progress envelope is well-formed and
// carries the retry hint the client uses to back off.

import { describe, it, expect } from 'vitest';

import { ErrorEnvelopeSchema } from '@concierge/core/errors';
import {
  AUTH_IN_PROGRESS_MESSAGE,
  AUTH_IN_PROGRESS_RETRY_AFTER_MS,
  buildAuthInProgressError,
} from '../../src/auth/in-progress-error.js';

describe('buildAuthInProgressError', () => {
  it('returns a well-formed envelope with the canonical error_code', () => {
    const env = buildAuthInProgressError();
    expect(env.ok).toBe(false);
    expect(env.error_code).toBe('auth_in_progress');
    expect(env.message).toBe(AUTH_IN_PROGRESS_MESSAGE);
    expect(env.retry_after_ms).toBe(AUTH_IN_PROGRESS_RETRY_AFTER_MS);
  });

  it('matches the outbound Zod schema (MCP wire shape)', () => {
    const env = buildAuthInProgressError();
    const parsed = ErrorEnvelopeSchema.safeParse(env);
    expect(parsed.success).toBe(true);
  });

  it('includes a positive retry_after_ms so clients back off before retrying', () => {
    const env = buildAuthInProgressError();
    expect(env.retry_after_ms).toBeGreaterThan(0);
  });
});
