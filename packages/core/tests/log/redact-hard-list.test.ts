// Hard-list "never-emit" tests (D17).
//
// The hard list is the set of patterns that MUST always redact, regardless
// of caller options (e.g., the future `concierge-setup --diagnose --full`
// flag). Today there is no opt-out, so the hard list is effectively
// always-on. This suite locks the contract:
//   1. Every hard-list item is removed.
//   2. The original sensitive value does NOT survive in the output.
//   3. The hard list applies in BOTH the credential-only `redactString`
//      AND the log surface `redactStringForLog`.
//
// Hard-list members (per D17):
//   - refresh_token values
//   - client_secret values
//   - access_token values
//   - id_token JWT bodies (the second base64 segment / the full JWT)
//
// Spec ref: setup-hardening-v2 spec D17, plan A3.

import { describe, it, expect } from 'vitest';

import {
  HARD_LIST_PATTERNS,
  redactString,
  redactStringForLog,
} from '../../src/log/redact.js';

interface HardListCase {
  readonly label: string;
  readonly input: string;
  readonly leakedValue: string;
}

const HARD_LIST_CASES: readonly HardListCase[] = [
  {
    label: 'refresh_token value',
    input: 'refresh_token="1//0gFAKE_REFRESH_VALUE_abc.def"',
    leakedValue: '1//0gFAKE_REFRESH_VALUE_abc.def',
  },
  {
    label: 'client_secret value',
    input: 'client_secret=GOCSPX-FAKE_CLIENT_SECRET_VALUE_abc',
    leakedValue: 'GOCSPX-FAKE_CLIENT_SECRET_VALUE_abc',
  },
  {
    label: 'access_token value',
    input: 'access_token: ya29.FAKE_ACCESS_TOKEN_VALUE_abc',
    leakedValue: 'ya29.FAKE_ACCESS_TOKEN_VALUE_abc',
  },
  {
    label: 'id_token JWT body (full triple-dot)',
    input:
      'id_token=eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJGQUtFX1NVQiJ9.SIGNATUREVALUE',
    // The middle segment (payload) is the identity-bearing part — assert
    // it does not survive in the output.
    leakedValue: 'eyJzdWIiOiJGQUtFX1NVQiJ9',
  },
];

describe('hard-list: redactString (credential surface) always scrubs', () => {
  it.each(HARD_LIST_CASES)('strips $label', ({ input, leakedValue }) => {
    const out = redactString(input);
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain(leakedValue);
  });
});

describe('hard-list: redactStringForLog (log surface) always scrubs', () => {
  it.each(HARD_LIST_CASES)('strips $label', ({ input, leakedValue }) => {
    const out = redactStringForLog(input);
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain(leakedValue);
  });
});

describe('hard-list registry', () => {
  it('exposes every hard-list pattern with category="hard-list"', () => {
    for (const p of HARD_LIST_PATTERNS) {
      expect(p.category).toBe('hard-list');
    }
  });

  it('covers the four D17 credential field names', () => {
    const names = HARD_LIST_PATTERNS.map((p) => p.name);
    expect(names).toContain('kv-refresh-token');
    expect(names).toContain('kv-client-secret');
    expect(names).toContain('kv-access-token');
    expect(names).toContain('kv-id-token');
  });
});
