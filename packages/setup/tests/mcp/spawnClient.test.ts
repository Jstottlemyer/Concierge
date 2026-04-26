// B5 tests: drive spawnClient.callConciergeInfo against a real fixture MCP
// server (tests/fixtures/mcp-server.js). No SDK mocking — that would defeat
// the purpose of the spawn-server check.
//
// Test timing: production defaults are 3s/5s. We pass 1s/1s here so a hung-
// fixture test resolves in ~1s wall-clock (target <6s per case). Cleanup is
// handled by callConciergeInfo itself (every code path calls client.close()
// which SIGTERMs the spawned child) but we sanity-check zero orphans at
// suite end.
//
// Fixture mode is selected via FIXTURE_MODE env var passed through process
// inheritance — but since callConciergeInfo inherits process.env, we set the
// env on the test process itself before each call and clean up afterEach.
//
// IMPORTANT: callConciergeInfo passes process.env to the child. So setting
// process.env['FIXTURE_MODE'] before the call is how the fixture observes
// mode selection.

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { callConciergeInfo } from '../../src/mcp/spawnClient.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '..', 'fixtures', 'mcp-server.js');

const FIXTURE_ENV_KEYS = [
  'FIXTURE_MODE',
  'FIXTURE_BUILD_ID',
  'FIXTURE_BUILD_TIME',
] as const;

afterEach(() => {
  for (const k of FIXTURE_ENV_KEYS) delete process.env[k];
});

function countOrphanFixtures(): number {
  // ps + grep is acceptable here — guardrail run exactly once at suite end.
  // Match only lines whose command starts with a `node`/`.../node` binary
  // invocation followed by the fixture path; avoid false positives from
  // vitest's own command-line / env that may transcribe the path string.
  try {
    const out = execSync('ps -A -o pid,command', { encoding: 'utf8' });
    const re = /\bnode\b[^\n]*\bfixtures\/mcp-server\.js\b/;
    return out.split('\n').filter((l) => re.test(l)).length;
  } catch {
    return 0;
  }
}

describe('callConciergeInfo', () => {
  it('happy path: returns ConciergeInfo from a working fixture server', async () => {
    process.env['FIXTURE_MODE'] = 'happy';
    process.env['FIXTURE_BUILD_ID'] = 'b5-happy-001';
    process.env['FIXTURE_BUILD_TIME'] = '2026-04-25T12:00:00Z';

    const result = await callConciergeInfo({
      distIndexJsAbsPath: FIXTURE,
      initTimeoutMs: 2000,
      toolCallTimeoutMs: 2000,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.buildId).toBe('b5-happy-001');
      expect(result.data.buildTime).toBe('2026-04-25T12:00:00Z');
      // tolerate-extra-fields contract:
      expect(result.data['extraField']).toBe('tolerated');
    }
  });

  it('init timeout: returns init-timeout when fixture never responds to initialize', async () => {
    process.env['FIXTURE_MODE'] = 'init-hang';

    const result = await callConciergeInfo({
      distIndexJsAbsPath: FIXTURE,
      initTimeoutMs: 600,
      toolCallTimeoutMs: 600,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('init-timeout');
      expect(result.error.message).toMatch(/initialize/i);
    }
  });

  it('tool-call timeout: initializes, then hangs on concierge_info', async () => {
    process.env['FIXTURE_MODE'] = 'tool-hang';

    const result = await callConciergeInfo({
      distIndexJsAbsPath: FIXTURE,
      initTimeoutMs: 2000,
      toolCallTimeoutMs: 600,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('tool-call-timeout');
    }
  });

  it('spawn failure: returns spawn-failed (or exit-nonzero) on a non-existent path', async () => {
    const result = await callConciergeInfo({
      distIndexJsAbsPath: '/definitely/does/not/exist/index.js',
      initTimeoutMs: 1500,
      toolCallTimeoutMs: 1500,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Node may surface the missing-script as either a spawn error or a
      // nonzero exit before init completes — accept either, both are
      // legitimate "this binary won't run" signals.
      expect(['spawn-failed', 'exit-nonzero', 'init-timeout']).toContain(
        result.error.kind,
      );
    }
  });

  it('tool returns error envelope: classified as tool-call-error', async () => {
    process.env['FIXTURE_MODE'] = 'tool-error';

    const result = await callConciergeInfo({
      distIndexJsAbsPath: FIXTURE,
      initTimeoutMs: 2000,
      toolCallTimeoutMs: 2000,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('tool-call-error');
      expect(result.error.message).toMatch(/simulated server-side failure/);
    }
  });

  it('process cleanup: zero orphan fixture processes after the suite', async () => {
    // Run after the other tests by virtue of declaration order; if vitest
    // ever reorders, this is still a valid assertion at any point because
    // every prior test awaited completion (which awaits client.close()).
    // Give the OS a beat to reap.
    await new Promise((r) => setTimeout(r, 200));
    expect(countOrphanFixtures()).toBe(0);
  });
});
