// T11.5 self-tests for the shared gws mock harness.
//
// We drive the real `runGws` from `src/gws/runner.ts` against a mock binary
// installed by `installGwsMock`. Success criteria:
//   - scenarios produce the configured stdout / stderr / exit codes
//   - delays propagate as durationMs
//   - call records capture argv, stdin, env
//   - uninstall restores CONCIERGE_GWS_BIN and removes the temp dir
//   - when the mock is NOT installed, real gws (or ENOENT) is in play —
//     we prove this by leaving CONCIERGE_GWS_BIN unset and ensuring our
//     install / uninstall doesn't leak state between tests.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { accessSync } from 'node:fs';

import {
  __resetVersionCacheForTests,
  runGws,
} from '../../src/gws/runner.js';
import { GWS_BIN_ENV } from '../../src/gws/paths.js';
import { installGwsMock, type InstalledGwsMock } from './gws-mock.js';
import {
  makeVersionScenario,
  makeDriveFilesListScenario,
  makeAuthListScenario,
  loadGwsResponseFixture,
} from './gws-mock-scenarios.js';

describe('gws-mock harness', () => {
  const priorBin = process.env[GWS_BIN_ENV];
  let mock: InstalledGwsMock | null = null;

  beforeEach(() => {
    __resetVersionCacheForTests();
  });

  afterEach(async () => {
    if (mock !== null) {
      await mock.uninstall();
      mock = null;
    }
    __resetVersionCacheForTests();
    // Safety net: ensure the env var is back where it started between tests.
    if (priorBin === undefined) {
      delete process.env[GWS_BIN_ENV];
    } else {
      process.env[GWS_BIN_ENV] = priorBin;
    }
  });

  it('matches exact argv and returns configured stdout + exit 0', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario('0.22.5-mock'),
        {
          matchArgs: ['drive', 'files', 'list'],
          stdout: '{"ok":true}\n',
          exitCode: 0,
        },
      ],
    });

    const result = await runGws(['drive', 'files', 'list']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('{"ok":true}');
    expect(result.gwsVersion).toContain('gws 0.22.5-mock');
  });

  it('returns configured stderr + nonzero exit code to runGws', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: ['broken'],
          stderr: 'simulated failure\n',
          exitCode: 7,
        },
      ],
    });

    const result = await runGws(['broken']);
    expect(result.exitCode).toBe(7);
    expect(result.stderr).toContain('simulated failure');
  });

  it('honors delayMs (durationMs >= configured delay)', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: ['slow'],
          stdout: 'done\n',
          delayMs: 150,
        },
      ],
    });

    const start = Date.now();
    const result = await runGws(['slow']);
    const elapsed = Date.now() - start;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('done');
    expect(elapsed).toBeGreaterThanOrEqual(140); // small jitter slack
  });

  it('records calls with argv, stdin, and env', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: ['echo', 'one'],
          stdout: 'ok\n',
        },
      ],
    });

    await runGws(['echo', 'one'], {
      stdin: 'piped-input',
      env: { CONCIERGE_TEST_TAG: 'alpha' },
    });

    const calls = mock.calls;
    // First call is the --version probe cached by runGws on first run.
    // Find our explicit call.
    const echoCall = calls.find((c) => c.args.length === 2 && c.args[0] === 'echo');
    expect(echoCall).toBeDefined();
    expect(echoCall?.args).toEqual(['echo', 'one']);
    expect(echoCall?.stdinReceived).toBe('piped-input');
    expect(echoCall?.envReceived['CONCIERGE_TEST_TAG']).toBe('alpha');
    expect(typeof echoCall?.timestamp).toBe('number');
  });

  it('tracks call counts and reset() clears history', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        { matchArgs: ['a'], stdout: '' },
        { matchArgs: ['b'], stdout: '' },
      ],
    });

    await runGws(['a']);
    await runGws(['b']);
    const countBefore = mock.getCallCount();
    expect(countBefore).toBeGreaterThanOrEqual(2);

    mock.reset();
    expect(mock.getCallCount()).toBe(0);

    await runGws(['a']);
    expect(mock.getCallCount()).toBe(1);
  });

  it('uses fallbackExitCode + fallbackStderr when no scenario matches', async () => {
    mock = await installGwsMock({
      scenarios: [makeVersionScenario()],
      fallbackExitCode: 99,
      fallbackStderr: 'no scenario\n',
    });

    const result = await runGws(['unknown', 'command']);
    expect(result.exitCode).toBe(99);
    expect(result.stderr).toContain('no scenario');
  });

  it('enforces strictOrder when requested', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(), // order[0]: the implicit --version probe
        { matchArgs: ['first'], stdout: 'one\n', exitCode: 0 },
        { matchArgs: ['second'], stdout: 'two\n', exitCode: 0 },
      ],
      strictOrder: true,
      fallbackExitCode: 42,
    });

    const a = await runGws(['first']);
    expect(a.exitCode).toBe(0);
    expect(a.stdout).toContain('one');

    const b = await runGws(['second']);
    expect(b.exitCode).toBe(0);
    expect(b.stdout).toContain('two');

    // Out-of-order attempt falls through to fallback.
    const c = await runGws(['first']);
    expect(c.exitCode).toBe(42);
  });

  it('loadGwsResponseFixture returns committed fixture bytes', () => {
    const drive = loadGwsResponseFixture('drive.files.list');
    const parsed = JSON.parse(drive) as unknown;
    expect(typeof parsed).toBe('object');
    expect(parsed).not.toBeNull();
  });

  it('makeDriveFilesListScenario produces the committed fixture', async () => {
    mock = await installGwsMock({
      scenarios: [makeVersionScenario(), makeDriveFilesListScenario()],
    });
    const result = await runGws(['drive', 'files', 'list', '--format', 'json']);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { kind?: string };
    expect(parsed.kind).toBe('drive#fileList');
  });

  it('makeAuthListScenario emits one-account-per-line + default marker', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        makeAuthListScenario(['primary@example.com', 'secondary@example.com']),
      ],
    });
    const result = await runGws(['auth', 'list']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('primary@example.com (default)');
    expect(result.stdout).toContain('secondary@example.com');
  });

  it('uninstall restores prior CONCIERGE_GWS_BIN and removes the temp dir', async () => {
    const preVal = process.env[GWS_BIN_ENV];
    const installed = await installGwsMock({
      scenarios: [makeVersionScenario()],
    });
    mock = installed;
    expect(process.env[GWS_BIN_ENV]).toBe(installed.binPath);

    const tmpDir = installed.tmpDir;
    await installed.uninstall();
    mock = null;

    if (preVal === undefined) {
      expect(process.env[GWS_BIN_ENV]).toBeUndefined();
    } else {
      expect(process.env[GWS_BIN_ENV]).toBe(preVal);
    }

    // Temp dir should be gone.
    let exists = true;
    try {
      accessSync(tmpDir);
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });

  it('uninstall is idempotent', async () => {
    mock = await installGwsMock({
      scenarios: [makeVersionScenario()],
    });
    await mock.uninstall();
    await mock.uninstall(); // should not throw
    mock = null;
  });
});
