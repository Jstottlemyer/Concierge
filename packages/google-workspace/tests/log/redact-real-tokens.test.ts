// Positive fixture corpus for the log redactor.
//
// Every string in POSITIVE_FIXTURES represents a real token shape that MUST
// be scrubbed before reaching stdout / logs / MCP responses. A failure here
// is a credential-leak regression — fix the regex, not the test.
//
// Spec ref: google-workspace-mcp spec.md AC §20, plan.md Decision #8.

import { describe, it, expect } from 'vitest';

import { redactString, redact } from '../../src/log/redact.js';

const POSITIVE_FIXTURES: readonly string[] = [
  // Google OAuth access token shape.
  'ya29.a0AbVbY6CacbRPCJHrBqCn4TRK9oF',

  // Google OAuth refresh token shape.
  '1//0eTbqwF8bK4JmCgYIARAAGA4SNwF-L9IrRyTiIyi1wF7PxEp4k5NZ',

  // Base64-encoded JWT triple-dot shape (header.payload.signature).
  'eyJhbGciOiJSUzI1NiIsImtpZCI6InZhbHVlIn0.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20ifQ.SIGNATURE_HERE_ABC123',

  // `access_token=` key-value shape, with quoted value containing a ya29.
  'access_token="ya29.abcd.efgh.ijkl"',

  // `refresh_token=` key-value shape, unquoted.
  'refresh_token=1//0abc.defg.hijk',

  // Google OAuth client-secret string-prefix shape.
  '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',

  // `client_secret=` key-value shape.
  'client_secret=somevalue',
];

describe('redact — positive fixtures (real token shapes)', () => {
  it(`covers ${String(POSITIVE_FIXTURES.length)} known-bad token shapes`, () => {
    // Sanity check so the corpus count is visible in CI output.
    expect(POSITIVE_FIXTURES.length).toBeGreaterThanOrEqual(7);
  });

  it.each(POSITIVE_FIXTURES)(
    'redacts fixture: %s',
    (fixture) => {
      const scrubbed = redactString(fixture);
      expect(scrubbed).toContain('[REDACTED]');
      // The raw fixture body must not survive intact. We assert that the
      // scrubbed output is different from the input — if a future regex
      // change allowed a token through verbatim, this fails.
      expect(scrubbed).not.toBe(fixture);
    },
  );

  it('redacts tokens embedded inside a larger log line', () => {
    const line = `[2026-04-13T12:00:00Z] gws stderr: auth bearer ya29.a0AbVbY6CacbRPCJHrBqCn4TRK9oF accepted`;
    const scrubbed = redactString(line);
    expect(scrubbed).toContain('[REDACTED]');
    expect(scrubbed).not.toContain('ya29.a0AbVbY6CacbRPCJHrBqCn4TRK9oF');
    // Surrounding context is preserved.
    expect(scrubbed).toContain('[2026-04-13T12:00:00Z]');
    expect(scrubbed).toContain('accepted');
  });

  it('redacts multiple tokens in a single string', () => {
    const line = 'access_token=ya29.FIRST and refresh_token=1//SECOND here';
    const scrubbed = redactString(line);
    expect(scrubbed).not.toContain('ya29.FIRST');
    expect(scrubbed).not.toContain('1//SECOND');
    // At least one [REDACTED] per token.
    const matches = scrubbed.match(/\[REDACTED\]/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('redact() applied to a string yields the same result as redactString()', () => {
    for (const fixture of POSITIVE_FIXTURES) {
      expect(redact(fixture)).toBe(redactString(fixture));
    }
  });
});
