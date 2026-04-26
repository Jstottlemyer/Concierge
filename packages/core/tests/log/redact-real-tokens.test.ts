// Positive fixture corpus for the credential-shape redactor.
//
// Every string here represents a real token shape that MUST be scrubbed
// before reaching stdout / logs / MCP responses. A failure here is a
// credential-leak regression — fix the regex, not the test.

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

  // `id_token=` key-value shape (D17 hard-list addition).
  'id_token="eyJhbGciOiJSUzI1NiJ9.PAYLOAD.SIG"',
];

describe('redactString — positive fixtures (real token shapes)', () => {
  it(`covers ${String(POSITIVE_FIXTURES.length)} known-bad token shapes`, () => {
    expect(POSITIVE_FIXTURES.length).toBeGreaterThanOrEqual(8);
  });

  it.each(POSITIVE_FIXTURES)('redacts fixture: %s', (fixture) => {
    const scrubbed = redactString(fixture);
    expect(scrubbed).toContain('[REDACTED]');
    expect(scrubbed).not.toBe(fixture);
  });
});

describe('redact — positive fixtures wrapped in JSON shapes', () => {
  it.each(POSITIVE_FIXTURES)('scrubs fixture inside an object: %s', (fixture) => {
    const out = redact({ envelope: fixture }) as Record<string, unknown>;
    expect(out['envelope']).toContain('[REDACTED]');
    expect(out['envelope']).not.toBe(fixture);
  });
});
