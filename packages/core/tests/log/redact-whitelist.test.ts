// Negative fixture corpus for the credential-shape redactor.
//
// Every string in NEGATIVE_FIXTURES is legitimate user content that a
// careless regex might mangle. `redactString` MUST pass these through
// unchanged. A failure here is a false-positive regression — tighten the
// regex, not the test.

import { describe, it, expect } from 'vitest';

import { redactString } from '../../src/log/redact.js';
import { NEGATIVE_FIXTURES } from '../../src/log/redact-whitelist.js';

describe('redactString — negative fixtures (legitimate content)', () => {
  it(`covers ${String(NEGATIVE_FIXTURES.length)} known-good strings`, () => {
    expect(NEGATIVE_FIXTURES.length).toBeGreaterThanOrEqual(4);
  });

  it.each(NEGATIVE_FIXTURES)(
    'passes through fixture unchanged: %s',
    (fixture) => {
      const scrubbed = redactString(fixture);
      expect(scrubbed).toBe(fixture);
      expect(scrubbed).not.toContain('[REDACTED]');
    },
  );
});
