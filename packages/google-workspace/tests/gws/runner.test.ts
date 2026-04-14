// T7 runner tests. We drive the real `spawn` path against a shell-script fake
// gws binary so we exercise the `shell: false` spawn code, timeout, and the
// AbortController plumbing end-to-end.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ConciergeError } from '@concierge/core/errors';
import {
  __resetVersionCacheForTests,
  DEFAULT_TIMEOUT_MS,
  getGwsVersion,
  runGws,
  TIMEOUT_EXIT_CODE,
  TIMEOUT_SIGNAL,
} from '../../src/gws/runner.js';
import { GWS_BIN_ENV } from '../../src/gws/paths.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FAKE_GWS = path.join(here, 'fixtures', 'fake-gws.sh');

describe('runGws / getGwsVersion', () => {
  const originalEnv = process.env[GWS_BIN_ENV];

  beforeEach(() => {
    process.env[GWS_BIN_ENV] = FAKE_GWS;
    __resetVersionCacheForTests();
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[GWS_BIN_ENV];
    } else {
      process.env[GWS_BIN_ENV] = originalEnv;
    }
    __resetVersionCacheForTests();
  });

  it('runs successfully and returns stdout + exitCode 0', async () => {
    const result = await runGws(['hello', 'world']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"ok":true');
    expect(result.stderr).toBe('');
    expect(result.signal).toBeNull();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.gwsVersion).toContain('gws 0.22.5-fake');
  });

  it('returns a non-zero exit code as a result (does not throw)', async () => {
    const result = await runGws(['--fail-code', '3', '--stderr', 'bad args']);
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain('bad args');
  });

  it('captures stderr content', async () => {
    const result = await runGws(['--stderr', 'hello from stderr']);
    expect(result.stderr).toContain('hello from stderr');
    expect(result.exitCode).toBe(0);
  });

  it('honors the timeoutMs option and surfaces exitCode -1 / SIGTERM', async () => {
    const result = await runGws(['--sleep', '2'], { timeoutMs: 150 });
    expect(result.exitCode).toBe(TIMEOUT_EXIT_CODE);
    expect(result.signal).toBe(TIMEOUT_SIGNAL);
    expect(result.durationMs).toBeLessThan(2000);
  });

  it('forwards stdin when provided', async () => {
    const result = await runGws(['--echo-stdin'], { stdin: 'piped-data' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('piped-data');
  });

  it('passes extra env vars to the child', async () => {
    const result = await runGws(['--print-env', 'CONCIERGE_TEST_TOKEN'], {
      env: { CONCIERGE_TEST_TOKEN: 'hello-env' },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('hello-env');
  });

  it('throws ConciergeError(gws_error) when the binary path is bogus', async () => {
    process.env[GWS_BIN_ENV] = '/no/such/binary/gws-does-not-exist';
    await expect(runGws(['anything'])).rejects.toBeInstanceOf(ConciergeError);
    try {
      await runGws(['anything']);
      throw new Error('unreachable');
    } catch (err) {
      expect(err).toBeInstanceOf(ConciergeError);
      expect((err as ConciergeError).code).toBe('gws_error');
    }
  });

  it('redacts known-shape tokens from stdout and stderr', async () => {
    // Fake prints argv into stdout and stderr — embed a ya29 token in both.
    const out = await runGws(['ya29.LEAK_TOKEN_ABC']);
    expect(out.stdout).not.toContain('ya29.LEAK_TOKEN_ABC');
    expect(out.stdout).toContain('[REDACTED]');

    const errOut = await runGws(['--stderr', 'leak ya29.LEAK_IN_STDERR here']);
    expect(errOut.stderr).not.toContain('ya29.LEAK_IN_STDERR');
    expect(errOut.stderr).toContain('[REDACTED]');
  });

  it('caches gws --version across calls', async () => {
    const first = await getGwsVersion();
    expect(first).toContain('gws 0.22.5-fake');

    // Point the override at a bogus path. If the cache wasn't populated the
    // second call would try to spawn and blow up.
    process.env[GWS_BIN_ENV] = '/no/such/binary/gws-missing-after-cache';
    const second = await getGwsVersion();
    expect(second).toBe(first);
  });

  it('__resetVersionCacheForTests clears the cached version', async () => {
    const first = await getGwsVersion();
    expect(first).toContain('0.22.5-fake');

    __resetVersionCacheForTests();
    process.env[GWS_BIN_ENV] = '/no/such/binary/gws-missing-after-reset';
    await expect(getGwsVersion()).rejects.toBeInstanceOf(ConciergeError);
  });

  it('populates gwsVersion on every successful RunResult', async () => {
    const r1 = await runGws(['hello']);
    const r2 = await runGws(['world']);
    expect(r1.gwsVersion).toBe(r2.gwsVersion);
    expect(r1.gwsVersion).toContain('gws ');
  });

  it('uses the default 30s timeout constant', () => {
    expect(DEFAULT_TIMEOUT_MS).toBe(30_000);
  });

  it('does not cache a failed version probe', async () => {
    // First call fails: bogus binary.
    process.env[GWS_BIN_ENV] = '/no/such/binary/gws-missing-first';
    await expect(getGwsVersion()).rejects.toBeInstanceOf(ConciergeError);

    // Restore + retry — cache must NOT be poisoned.
    process.env[GWS_BIN_ENV] = FAKE_GWS;
    const ok = await getGwsVersion();
    expect(ok).toContain('0.22.5-fake');
  });

  it('running with an empty args array still produces a result', async () => {
    const result = await runGws([]);
    // fake-gws falls through to the default case for empty argv and exits 0.
    expect(result.exitCode).toBe(0);
  });
});
