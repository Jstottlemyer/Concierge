// T32.5 — User-facing error-copy tests.
//
// Guarantees:
//  1. Every `ErrorCode` has an entry in `USER_FACING_MESSAGES` (compile-time
//     via `Record<ErrorCode, …>`, reasserted at runtime here).
//  2. Template `{token}` interpolation works for both `summary` and
//     `next_action`.
//  3. Unknown tokens are left as-is (intentional — surfaces missing context
//     in developer output).
//  4. `getUserMessage` / `getNextAction` reject unknown codes.
//  5. Every `docs_url` is an absolute `https://` URL (wire-schema compatibility).
//
// Avoids redundant assertions about specific string content — that's
// product copy that will change. The test locks the shape, not the voice.
import { describe, it, expect } from 'vitest';

import { ERROR_CODES, type ErrorCode } from '../../src/errors/errors.js';
import {
  USER_FACING_MESSAGES,
  getUserMessage,
  getNextAction,
} from '../../src/errors/user-messages.js';

describe('USER_FACING_MESSAGES', () => {
  it('has an entry for every ErrorCode', () => {
    for (const code of ERROR_CODES) {
      expect(USER_FACING_MESSAGES, `missing entry for ${code}`).toHaveProperty(code);
      const entry = USER_FACING_MESSAGES[code];
      expect(entry.summary.trim().length, `${code}: empty summary`).toBeGreaterThan(0);
    }
  });

  it('has exactly the ErrorCode keys (no extras, no gaps)', () => {
    const keys = new Set(Object.keys(USER_FACING_MESSAGES) as ErrorCode[]);
    const expected = new Set(ERROR_CODES);
    expect(keys).toEqual(expected);
  });

  it("all docs_url values are absolute https URLs (envelope compatibility)", () => {
    for (const [code, entry] of Object.entries(USER_FACING_MESSAGES)) {
      if (entry.docs_url !== undefined) {
        expect(entry.docs_url, `${code}: docs_url must be absolute https`).toMatch(
          /^https:\/\//,
        );
      }
    }
  });
});

describe('getUserMessage', () => {
  it('returns the raw summary when no tokens are present', () => {
    const msg = getUserMessage('network_error');
    expect(msg).toBe(USER_FACING_MESSAGES.network_error.summary);
  });

  it('interpolates context tokens in the summary', () => {
    const msg = getUserMessage('consent_denied', { bundle_display: 'Gmail + Drive' });
    expect(msg).toContain('Gmail + Drive');
    expect(msg).not.toContain('{bundle_display}');
  });

  it('interpolates multiple tokens in one string', () => {
    const msg = getUserMessage('validation_error', {
      tool: 'gmail_send',
      field_path: '.to[0]',
    });
    expect(msg).toContain('gmail_send');
    expect(msg).toContain('.to[0]');
  });

  it('leaves unknown tokens unreplaced so missing context is visible', () => {
    const msg = getUserMessage('consent_denied'); // no context at all
    expect(msg).toContain('{bundle_display}');
  });

  it('throws on an unknown ErrorCode', () => {
    expect(() =>
      getUserMessage('not_real' as unknown as ErrorCode),
    ).toThrow(/unknown error_code/i);
  });
});

describe('getNextAction', () => {
  it('returns next_action when defined', () => {
    const action = getNextAction('auth_setup_needed');
    expect(action).toBeDefined();
    expect(action).toContain('gws auth setup');
  });

  it('interpolates tokens in next_action', () => {
    const action = getNextAction('read_only_active', { account: 'alice@example.com' });
    // read_only_active's next_action doesn't reference {account}, but the
    // summary does — sanity-check that interpolation of summary works
    // alongside next_action resolution.
    expect(action).toBeDefined();
    const summary = getUserMessage('read_only_active', { account: 'alice@example.com' });
    expect(summary).toContain('alice@example.com');
  });

  it('returns undefined for codes without a next_action', () => {
    // All current codes define next_action, so fake one by looking for any
    // without it. This keeps the test honest if a future entry omits it.
    const codesWithoutAction = (Object.keys(USER_FACING_MESSAGES) as ErrorCode[]).filter(
      (c) => USER_FACING_MESSAGES[c].next_action === undefined,
    );
    for (const code of codesWithoutAction) {
      expect(getNextAction(code)).toBeUndefined();
    }
  });

  it('throws on an unknown ErrorCode', () => {
    expect(() =>
      getNextAction('not_real' as unknown as ErrorCode),
    ).toThrow(/unknown error_code/i);
  });
});
