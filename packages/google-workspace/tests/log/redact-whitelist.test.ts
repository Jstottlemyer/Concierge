// Negative fixture corpus for the log redactor.
//
// Every string in NEGATIVE_FIXTURES is legitimate user content that a careless
// regex might mangle. The scrubber MUST pass these through unchanged. A
// failure here is a false-positive regression — tighten the regex, not the
// test. Zero false positives is as important as zero false negatives per
// plan.md Decision #8.

import { describe, it, expect } from 'vitest';

import { redactString } from '../../src/log/redact.js';
import { NEGATIVE_FIXTURES } from '../../src/log/redact-whitelist.js';

describe('redact — negative fixtures (legitimate content, pass through)', () => {
  it(`covers ${String(NEGATIVE_FIXTURES.length)} known-good strings`, () => {
    // Sanity check so the corpus count is visible in CI output.
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

  it('does not mangle a long benign paragraph', () => {
    const paragraph =
      'Rotate your client_secret regularly. The access_tokenless design ' +
      'means we never store a bearer. Meeting at 1// (shorthand). ' +
      'The deadline is 2024-03-15. See docs at ' +
      'https://docs.example.com/client_secret_migration for details.';
    expect(redactString(paragraph)).toBe(paragraph);
  });
});
