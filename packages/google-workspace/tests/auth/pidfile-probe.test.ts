// T10 pidfile-probe tests.
//
// We don't have a real gws install available in CI, so the tests exercise the
// probe against a temporary "config dir" under `os.tmpdir()`. The positive
// "process is alive" case uses `process.pid` (the test runner itself) which is
// guaranteed to be alive for the duration of the test.
//
// `findGwsAuthProcess` is exercised via a stubbed `spawn` (see bottom of
// file) rather than the live `ps` binary — otherwise the test false-positives
// on a dev machine that happens to have `gws auth login` running in another
// terminal (which is a normal state during live Concierge testing).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';

// --- vi.mock must be at top-level (hoisted). We stub `spawn` so the
//     findGwsAuthProcess tests below don't depend on the host's live
//     process table. `authInProgressProbe` tests that actually need the
//     real process list pass `skipProcessList: true`, so this mock doesn't
//     interfere with them.
const { spawnMock } = vi.hoisted(() => {
  return { spawnMock: vi.fn() };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('node:child_process');
  return {
    ...actual,
    spawn: spawnMock,
  };
});

import {
  authInProgressProbe,
  defaultAuthInProgressProbe,
  findGwsAuthProcess,
  isProcessAlive,
  readPidfile,
} from '../../src/auth/pidfile-probe.js';

// A PID that is almost certainly not in use. The Linux default max PID is
// 2^22 and macOS caps at 99999 by default, so 2_000_000 is safely above both.
const UNLIKELY_DEAD_PID = 2_000_000;

describe('readPidfile', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'pidfile-probe-'));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns null when the file does not exist', async () => {
    const result = await readPidfile(path.join(tmpDir, 'missing.pid'));
    expect(result).toBeNull();
  });

  it('parses a valid PID with trailing newline', async () => {
    const pidPath = path.join(tmpDir, 'auth.pid');
    writeFileSync(pidPath, `${String(process.pid)}\n`, 'utf8');
    expect(await readPidfile(pidPath)).toBe(process.pid);
  });

  it('returns null for an empty file', async () => {
    const pidPath = path.join(tmpDir, 'auth.pid');
    writeFileSync(pidPath, '   \n', 'utf8');
    expect(await readPidfile(pidPath)).toBeNull();
  });

  it('returns null for malformed content', async () => {
    const pidPath = path.join(tmpDir, 'auth.pid');
    writeFileSync(pidPath, 'not-a-number', 'utf8');
    expect(await readPidfile(pidPath)).toBeNull();

    writeFileSync(pidPath, '42abc', 'utf8');
    expect(await readPidfile(pidPath)).toBeNull();

    writeFileSync(pidPath, '-17', 'utf8');
    expect(await readPidfile(pidPath)).toBeNull();
  });
});

describe('isProcessAlive', () => {
  it('returns true for the current process', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it('returns false for a clearly-dead PID', () => {
    expect(isProcessAlive(UNLIKELY_DEAD_PID)).toBe(false);
  });

  it('returns false for pid 0 and negative pids', () => {
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
  });

  it('returns false for non-finite input', () => {
    expect(isProcessAlive(Number.NaN)).toBe(false);
    expect(isProcessAlive(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe('findGwsAuthProcess', () => {
  // The top-level `vi.mock('node:child_process')` swaps `spawn` with
  // `spawnMock`. Each test here provides a canned `ps` listing so the result
  // is deterministic regardless of the host machine's state. (Previously the
  // test called the real `ps` binary and grepped its output, which
  // false-positives whenever the developer is running `gws auth login` in
  // another terminal — a routine state during live Concierge testing.)

  function stubPsOutput(stdout: string, exitCode = 0): void {
    spawnMock.mockImplementationOnce(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: Readable;
        stderr: Readable;
      };
      child.stdout = Readable.from([Buffer.from(stdout, 'utf8')]);
      child.stderr = Readable.from([]);
      // Emit close on next tick so listeners have a chance to register.
      setTimeout(() => {
        child.emit('close', exitCode);
      }, 0);
      return child;
    });
  }

  beforeEach(() => {
    spawnMock.mockReset();
  });

  it('returns false when the ps listing contains no gws auth line (deterministic)', async () => {
    // Canned ps output with no gws-related lines. Independent of the host
    // machine — a dev running `gws auth login` in another terminal does NOT
    // affect this test.
    stubPsOutput(
      [
        '  PID COMMAND',
        `  ${String(process.pid)} /usr/bin/node /some/test/runner.mjs`,
        '  1234 /usr/sbin/syslogd',
        '  5678 /System/Library/Frameworks/CoreServices.framework/Helper',
        '',
      ].join('\n'),
    );

    const found = await findGwsAuthProcess(2_000);
    expect(found).toBe(false);
  });

  it('returns true when the ps listing contains a non-self gws auth line', async () => {
    const otherPid = process.pid === 9999 ? 9998 : 9999;
    stubPsOutput(
      [
        '  PID COMMAND',
        `  ${String(process.pid)} /usr/bin/node /some/test/runner.mjs`,
        `  ${String(otherPid)} /usr/local/bin/gws auth login`,
        '',
      ].join('\n'),
    );

    const found = await findGwsAuthProcess(2_000);
    expect(found).toBe(true);
  });

  it('ignores a gws auth line belonging to the current process', async () => {
    // Word-boundary regex + self-PID filter: even if the test runner's own
    // argv mentions gws+auth, it must not count as evidence.
    stubPsOutput(
      [
        '  PID COMMAND',
        `  ${String(process.pid)} /usr/bin/node fake gws auth wrapper`,
        '',
      ].join('\n'),
    );

    const found = await findGwsAuthProcess(2_000);
    expect(found).toBe(false);
  });
});

describe('authInProgressProbe', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'pidfile-probe-'));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns false when no pidfile, no lockfile, and ps scan skipped', async () => {
    const result = await authInProgressProbe({
      configDir: tmpDir,
      skipProcessList: true,
    });
    expect(result).toBe(false);
  });

  it('returns true when pidfile exists and points at a live process', async () => {
    // Use the test runner's own PID — guaranteed to be alive for the test.
    writeFileSync(path.join(tmpDir, 'auth.pid'), String(process.pid), 'utf8');
    const result = await authInProgressProbe({
      configDir: tmpDir,
      skipProcessList: true,
    });
    expect(result).toBe(true);
  });

  it('returns false when pidfile points at a dead process', async () => {
    writeFileSync(path.join(tmpDir, 'auth.pid'), String(UNLIKELY_DEAD_PID), 'utf8');
    const result = await authInProgressProbe({
      configDir: tmpDir,
      skipProcessList: true,
    });
    expect(result).toBe(false);
  });

  it('returns false when pidfile is malformed and no other evidence', async () => {
    writeFileSync(path.join(tmpDir, 'auth.pid'), 'junk', 'utf8');
    const result = await authInProgressProbe({
      configDir: tmpDir,
      skipProcessList: true,
    });
    expect(result).toBe(false);
  });

  it('returns true when only the credentials lockfile is present', async () => {
    writeFileSync(path.join(tmpDir, 'credentials.enc.lock'), '', 'utf8');
    const result = await authInProgressProbe({
      configDir: tmpDir,
      skipProcessList: true,
    });
    expect(result).toBe(true);
  });

  it('default probe (no options) runs without throwing', async () => {
    // Exercises the full default code path including env-based configDir
    // resolution and ps scan. The global spawn mock covers the ps scan with
    // an empty listing so this test is deterministic on any host. The
    // pidfile + lockfile strategies read real paths — on a machine without a
    // live gws auth, both miss, and the probe returns false.
    spawnMock.mockImplementationOnce(() => {
      const child = new EventEmitter() as EventEmitter & {
        stdout: Readable;
        stderr: Readable;
      };
      child.stdout = Readable.from([Buffer.from('  PID COMMAND\n', 'utf8')]);
      child.stderr = Readable.from([]);
      setTimeout(() => {
        child.emit('close', 0);
      }, 0);
      return child;
    });
    await expect(defaultAuthInProgressProbe()).resolves.toBeTypeOf('boolean');
  });
});
