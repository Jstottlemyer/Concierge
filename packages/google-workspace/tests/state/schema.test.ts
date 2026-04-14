import { describe, it, expect } from 'vitest';

import {
  AccountEntrySchema,
  CURRENT_STATE_SCHEMA_VERSION,
  EmailSchema,
  freshStateV1,
  StateV1Schema,
} from '../../src/state/schema.js';

describe('StateV1Schema', () => {
  it('accepts a fresh v1 state', () => {
    const fresh = freshStateV1();
    const parsed = StateV1Schema.parse(fresh);
    expect(parsed.state_schema_version).toBe(CURRENT_STATE_SCHEMA_VERSION);
    expect(parsed.default_account).toBeNull();
    expect(parsed.accounts).toEqual({});
  });

  it('accepts a populated v1 state with matching default_account', () => {
    const result = StateV1Schema.safeParse({
      state_schema_version: 1,
      default_account: 'alice@example.com',
      accounts: {
        'alice@example.com': { read_only: false },
        'bob@example.com': { read_only: true },
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects state with a non-literal schema version', () => {
    const result = StateV1Schema.safeParse({
      state_schema_version: 2,
      default_account: null,
      accounts: {},
    });
    expect(result.success).toBe(false);
  });

  it('rejects state with default_account not present in accounts (referential integrity)', () => {
    const result = StateV1Schema.safeParse({
      state_schema_version: 1,
      default_account: 'ghost@example.com',
      accounts: {
        'alice@example.com': { read_only: false },
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues[0];
      expect(issue?.path).toEqual(['default_account']);
      // Referential-integrity issues are flagged with params.concierge so the
      // loader can detect them and self-repair instead of bailing.
      expect(issue?.code).toBe('custom');
      // `$ZodIssue` is a discriminated union; `params` only lives on the
      // `custom` variant. Cast via unknown to access it portably in test.
      const rawIssue = issue as unknown as { params?: Record<string, unknown> };
      expect(rawIssue.params?.['concierge']).toBe('referential_integrity');
    }
  });

  it('rejects unknown top-level fields (strict)', () => {
    const result = StateV1Schema.safeParse({
      state_schema_version: 1,
      default_account: null,
      accounts: {},
      telemetry: { enabled: true },
    });
    expect(result.success).toBe(false);
  });

  it('rejects unknown per-account fields (strict)', () => {
    const result = AccountEntrySchema.safeParse({
      read_only: false,
      last_seen: '2025-01-01',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-email account keys', () => {
    const result = StateV1Schema.safeParse({
      state_schema_version: 1,
      default_account: null,
      accounts: {
        'not-an-email': { read_only: false },
      },
    });
    expect(result.success).toBe(false);
  });

  it('EmailSchema accepts a typical gmail address', () => {
    expect(EmailSchema.safeParse('alice@example.com').success).toBe(true);
  });

  it('EmailSchema rejects an empty string', () => {
    expect(EmailSchema.safeParse('').success).toBe(false);
  });
});
