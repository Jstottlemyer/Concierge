// Recursion + structural tests for `redact()` and `redactForLog()`.
//
// Both functions are called on arbitrary MCP payloads / log payloads
// before they leave the process. These tests lock in the contract:
// recurse into arrays and objects, scrub both keys and values, pass
// non-string scalars through, and never mutate the input.

import { describe, it, expect } from 'vitest';

import { redact, redactForLog } from '../../src/log/redact.js';

describe('redact — recursion and structural clone', () => {
  it('returns non-string scalars unchanged', () => {
    expect(redact(42)).toBe(42);
    expect(redact(0)).toBe(0);
    expect(redact(true)).toBe(true);
    expect(redact(false)).toBe(false);
    expect(redact(null)).toBe(null);
    expect(redact(undefined)).toBe(undefined);
  });

  it('redacts a top-level string', () => {
    expect(redact('bearer ya29.LEAKED_TOKEN_abc123')).toBe(
      'bearer [REDACTED]',
    );
  });

  it('recurses into arrays, redacting string elements', () => {
    const input = [
      'ya29.TOKEN_ONE_abc',
      'plain text',
      42,
      true,
      '1//TOKEN_TWO_xyz',
    ];
    const out = redact(input) as unknown[];
    expect(Array.isArray(out)).toBe(true);
    expect(out[0]).toBe('[REDACTED]');
    expect(out[1]).toBe('plain text');
    expect(out[2]).toBe(42);
    expect(out[3]).toBe(true);
    expect(out[4]).toBe('[REDACTED]');
  });

  it('recurses into plain objects, redacting credential values but preserving emails', () => {
    // `redact()` is the credential-only surface — it must NOT touch the
    // email. (PII redaction is opt-in via `redactForLog`.)
    const input = {
      authorization: 'Bearer ya29.LEAKED_abc',
      user: 'alice@example.com',
      count: 7,
    };
    const out = redact(input) as Record<string, unknown>;
    expect(out['authorization']).toBe('Bearer [REDACTED]');
    expect(out['user']).toBe('alice@example.com');
    expect(out['count']).toBe(7);
  });

  it('redacts object keys that contain token-shaped strings', () => {
    const input: Record<string, string> = {
      'ya29.LEAKED_KEY_abc': 'value',
      normal: 'ok',
    };
    const out = redact(input) as Record<string, unknown>;
    const keys = Object.keys(out);
    expect(keys).toContain('[REDACTED]');
    expect(keys).toContain('normal');
    expect(keys).not.toContain('ya29.LEAKED_KEY_abc');
  });

  it('recurses through nested structures', () => {
    const input = {
      result: {
        tokens: [
          { access_token: 'ya29.NESTED_abc', expires_in: 3600 },
          { refresh_token: '1//NESTED_xyz' },
        ],
        note: 'no secrets here',
      },
    };
    const out = redact(input) as {
      result: {
        tokens: Array<Record<string, unknown>>;
        note: string;
      };
    };
    const first = out.result.tokens[0];
    const second = out.result.tokens[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first?.['access_token']).toBe('[REDACTED]');
    expect(first?.['expires_in']).toBe(3600);
    expect(second?.['refresh_token']).toBe('[REDACTED]');
    expect(out.result.note).toBe('no secrets here');
  });

  it('does not mutate the input object', () => {
    const input = { token: 'ya29.STILL_HERE_abc', n: 1 };
    const snapshot = JSON.stringify(input);
    redact(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('does not mutate the input array', () => {
    const input = ['ya29.STILL_HERE_abc', 1, 2];
    const snapshot = JSON.stringify(input);
    redact(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('returns a fresh object (reference inequality)', () => {
    const input = { a: 1 };
    const out = redact(input);
    expect(out).not.toBe(input);
  });

  it('returns a fresh array (reference inequality)', () => {
    const input = [1, 2, 3];
    const out = redact(input);
    expect(out).not.toBe(input);
  });
});

describe('redactForLog — recursion + PII', () => {
  it('redacts emails in object values', () => {
    const out = redactForLog({
      user: 'alice@example.com',
      count: 7,
    }) as Record<string, unknown>;
    expect(out['user']).toBe('[email]');
    expect(out['count']).toBe(7);
  });

  it('redacts emails inside nested arrays', () => {
    const out = redactForLog([
      { owner: 'bob@example.com' },
      'plain text',
      'ya29.LEAK_abc',
    ]) as unknown[];
    expect((out[0] as Record<string, string>)['owner']).toBe('[email]');
    expect(out[1]).toBe('plain text');
    expect(out[2]).toBe('[REDACTED]');
  });

  it('does not mutate the input', () => {
    const input = { user: 'carol@example.com' };
    const snapshot = JSON.stringify(input);
    redactForLog(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
