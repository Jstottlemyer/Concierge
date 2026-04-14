// T28 — log-scan corpus gate (AC §20).
//
// Always-on credential-leak regression suite. Two layers:
//
//   1. Line-by-line scan of `tests/fixtures/log-scan/positive-tokens.txt`.
//      Each line is a known-bad token shape that MUST reduce to `[REDACTED]`
//      after passing through `redactString`. Mirror of the coverage in
//      `tests/log/redact-real-tokens.test.ts` but driven off the on-disk
//      fixture file so adding a new positive-token line is a one-file
//      change — the corpus grows without editing a TypeScript array.
//
//   2. Whole-transcript scan of a representative MCP session recording
//      (`tests/fixtures/log-scan/sample-session-transcript.txt`). The
//      transcript contains every kind of MCP stdout/stderr we emit:
//      initialize handshake, progress notifications, tool results,
//      structured error envelopes, gws stderr warnings, and debug
//      traces. KNOWN-FAKE tokens from `positive-tokens.txt` are embedded
//      in places a credential leak would realistically appear. The
//      assertion is simple and brittle-on-purpose: after running the
//      whole file through `redactString`, none of the positive-token
//      body substrings can survive.
//
// This file runs unconditionally in both default and `CONCIERGE_INTEGRATION`
// modes — the whole point is a CI gate that fires every build.
//
// Spec refs: google-workspace-mcp spec.md AC §20, plan.md Decision #8.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { redactString } from '../../src/log/redact.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(HERE, '..', 'fixtures', 'log-scan');
const POSITIVE_TOKENS_PATH = join(FIXTURES_DIR, 'positive-tokens.txt');
const TRANSCRIPT_PATH = join(FIXTURES_DIR, 'sample-session-transcript.txt');

/** Non-empty token lines from the positive-tokens corpus. */
function loadPositiveTokens(): string[] {
  const text = readFileSync(POSITIVE_TOKENS_PATH, 'utf8');
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Extract the token *body* substring that must not survive redaction.
 *
 * Some fixture lines are key=value shapes like `access_token="ya29.FOO"`.
 * The redactor rewrites the whole match (key, separator, value) to
 * `[REDACTED]`, so asserting that the raw fixture line is absent would
 * be trivially true even without the key-value rule firing. We want a
 * stricter check: the *token value* itself must not appear anywhere in
 * the output. For shaped tokens (ya29./1///GOCSPX-/JWT) the line IS
 * the body. For key=value shapes we peel off the leading key and any
 * surrounding quotes.
 */
function extractTokenBody(line: string): string {
  // key=value or key="value" shapes.
  const kvMatch = /^(?:access_token|refresh_token|client_secret)\s*[=:]\s*"?([^\s"]+)"?\s*$/.exec(
    line,
  );
  if (kvMatch !== null && kvMatch[1] !== undefined) {
    return kvMatch[1];
  }
  return line;
}

describe('AC §20 log-scan corpus gate (T28)', () => {
  // -----------------------------------------------------------------
  // Layer 1: every known-bad fixture line reduces to [REDACTED].
  // -----------------------------------------------------------------
  const positives = loadPositiveTokens();

  it(`loads the positive-token corpus (${String(positives.length)} entries)`, () => {
    // Tripwire so the fixture can never silently shrink to zero.
    expect(positives.length).toBeGreaterThanOrEqual(7);
  });

  it.each(positives)('fixture line is fully redacted: %s', (fixtureLine) => {
    const scrubbed = redactString(fixtureLine);
    expect(scrubbed, 'redactString output must contain the [REDACTED] marker').toContain(
      '[REDACTED]',
    );
    // The token body itself must NOT appear in the output. For key=value
    // lines this asserts the value substring; for shaped tokens this is
    // the whole line.
    const body = extractTokenBody(fixtureLine);
    expect(scrubbed).not.toContain(body);
  });

  // -----------------------------------------------------------------
  // Layer 2: sample MCP transcript survives the redactor with zero
  // positive-token bodies intact.
  // -----------------------------------------------------------------
  it('sample MCP session transcript contains known positive tokens before redaction', () => {
    // Sanity check — we must be able to prove the transcript fixture
    // actually contains the tokens we're about to scrub. Otherwise the
    // next test is a no-op.
    const raw = readFileSync(TRANSCRIPT_PATH, 'utf8');
    let found = 0;
    for (const fixtureLine of positives) {
      const body = extractTokenBody(fixtureLine);
      if (raw.includes(body)) found++;
    }
    expect(
      found,
      'expected the transcript to embed at least 4 of the positive-token bodies before scrubbing',
    ).toBeGreaterThanOrEqual(4);
  });

  it('sample MCP session transcript: zero positive-token bodies survive redactString', () => {
    const raw = readFileSync(TRANSCRIPT_PATH, 'utf8');
    const scrubbed = redactString(raw);

    const leaks: string[] = [];
    for (const fixtureLine of positives) {
      const body = extractTokenBody(fixtureLine);
      if (scrubbed.includes(body)) {
        leaks.push(body);
      }
    }

    expect(
      leaks,
      `redactor leaked ${String(leaks.length)} token bodies:\n${leaks.join('\n')}`,
    ).toEqual([]);
  });

  it('sample transcript is still human-readable after redaction (non-token prose preserved)', () => {
    const raw = readFileSync(TRANSCRIPT_PATH, 'utf8');
    const scrubbed = redactString(raw);

    // Structural markers must survive — the whole point of allowlist-based
    // redaction is that we do not mangle protocol envelopes or timestamps.
    expect(scrubbed).toContain('[2026-04-13T12:00:00.010Z]');
    expect(scrubbed).toContain('authtools mcp server starting');
    expect(scrubbed).toContain('"jsonrpc":"2.0"');
    expect(scrubbed).toContain('notifications/progress');
    expect(scrubbed).toContain('error_code');
    expect(scrubbed).toContain('consent_denied');
    expect(scrubbed).toContain('expired_refresh_fail');
    expect(scrubbed).toContain('network_error');
    expect(scrubbed).toContain('keychain_locked');
    // Redactor must have fired at all.
    expect(scrubbed).toContain('[REDACTED]');
  });
});
