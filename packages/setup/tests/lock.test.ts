// Tests for B3: PID lockfile.
//
// We use the real filesystem (`os.tmpdir()`) per-test rather than memfs,
// because the implementation shells out to `ps` for PID-reuse detection and
// memfs would not intercept that. Each test gets a unique lock path under a
// dedicated tmp directory so they remain isolated under `vitest --threads`.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { acquireLock } from '../src/lock.js';
import type { LockFile } from '../src/types/lock.js';

function freshLockPath(): string {
  const dir = mkdtempSync(join(os.tmpdir(), 'concierge-lock-test-'));
  return join(dir, 'nested', 'setup.lock');
}

/**
 * Read this process's own start time via `ps -o lstart=`. Used to synthesize
 * lockfile fixtures that pass the PID-reuse check (since we use process.pid as
 * a guaranteed-live PID).
 */
function ownStartedAtIso(): string {
  const out = execFileSync('ps', ['-o', 'lstart=', '-p', String(process.pid)], {
    encoding: 'utf8',
  }).trim();
  const ms = Date.parse(out);
  return new Date(ms).toISOString();
}

/** A high random PID we expect to be unallocated. Retries on collision. */
function deadPid(): number {
  for (let i = 0; i < 32; i++) {
    const candidate = 900_000 + Math.floor(Math.random() * 90_000);
    try {
      process.kill(candidate, 0);
      // It was alive — try a different number.
    } catch {
      return candidate;
    }
  }
  throw new Error('could not synthesize a dead PID after 32 attempts');
}

describe('acquireLock', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('acquires on a clean path and writes a valid LockFile body', async () => {
    const lockPath = freshLockPath();
    const result = await acquireLock(lockPath, '2.0.0');
    expect(result.kind).toBe('acquired');
    expect(existsSync(lockPath)).toBe(true);

    const body = JSON.parse(readFileSync(lockPath, 'utf8')) as LockFile;
    expect(body.pid).toBe(process.pid);
    expect(body.hostname).toBe(os.hostname());
    expect(body.setupVersion).toBe('2.0.0');
    expect(typeof body.startedAt).toBe('string');
    expect(Number.isNaN(Date.parse(body.startedAt))).toBe(false);

    if (result.kind === 'acquired') await result.release();
  });

  it('release() deletes the lockfile and is idempotent', async () => {
    const lockPath = freshLockPath();
    const result = await acquireLock(lockPath, '2.0.0');
    if (result.kind !== 'acquired') throw new Error('expected acquired');

    expect(existsSync(lockPath)).toBe(true);
    await result.release();
    expect(existsSync(lockPath)).toBe(false);

    // Idempotent: second call must not throw.
    await expect(result.release()).resolves.toBeUndefined();
    expect(existsSync(lockPath)).toBe(false);
  });

  it('returns blocked when the recorded PID is alive AND lstart matches', async () => {
    const lockPath = freshLockPath();
    // Ensure parent dir exists (acquireLock would do this, but we're writing
    // the fixture by hand).
    const fixture: LockFile = {
      pid: process.pid,
      startedAt: ownStartedAtIso(),
      hostname: os.hostname(),
      setupVersion: '1.9.9',
    };
    // Use acquireLock once to get the parent dir mkdir'd, then immediately
    // overwrite with the fixture.
    const seed = await acquireLock(lockPath, '0.0.0');
    if (seed.kind !== 'acquired') throw new Error('seed acquire failed');
    await seed.release();
    writeFileSync(lockPath, JSON.stringify(fixture, null, 2));

    const result = await acquireLock(lockPath, '2.0.0');
    expect(result.kind).toBe('blocked');
    if (result.kind === 'blocked') {
      expect(result.holder.pid).toBe(process.pid);
      expect(result.holder.setupVersion).toBe('1.9.9');
    }
  });

  it('reclaims when the recorded PID is dead', async () => {
    const lockPath = freshLockPath();
    const seed = await acquireLock(lockPath, '0.0.0');
    if (seed.kind !== 'acquired') throw new Error('seed acquire failed');
    await seed.release();

    const fixture: LockFile = {
      pid: deadPid(),
      startedAt: new Date().toISOString(),
      hostname: os.hostname(),
      setupVersion: '1.9.9',
    };
    writeFileSync(lockPath, JSON.stringify(fixture, null, 2));

    const result = await acquireLock(lockPath, '2.0.0');
    expect(result.kind).toBe('acquired');
    const body = JSON.parse(readFileSync(lockPath, 'utf8')) as LockFile;
    expect(body.pid).toBe(process.pid);
    expect(body.setupVersion).toBe('2.0.0');
  });

  it('reclaims when hostname differs (cross-host NFS case)', async () => {
    const lockPath = freshLockPath();
    const seed = await acquireLock(lockPath, '0.0.0');
    if (seed.kind !== 'acquired') throw new Error('seed acquire failed');
    await seed.release();

    const fixture: LockFile = {
      pid: process.pid, // even an alive PID is reclaimed if cross-host
      startedAt: ownStartedAtIso(),
      hostname: `not-${os.hostname()}`,
      setupVersion: '1.9.9',
    };
    writeFileSync(lockPath, JSON.stringify(fixture, null, 2));

    const result = await acquireLock(lockPath, '2.0.0');
    expect(result.kind).toBe('acquired');
    const body = JSON.parse(readFileSync(lockPath, 'utf8')) as LockFile;
    expect(body.hostname).toBe(os.hostname());
  });

  it('reclaims with warning when the recorded startedAt is > 24h old', async () => {
    const lockPath = freshLockPath();
    const seed = await acquireLock(lockPath, '0.0.0');
    if (seed.kind !== 'acquired') throw new Error('seed acquire failed');
    await seed.release();

    const fixture: LockFile = {
      pid: process.pid,
      startedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
      hostname: os.hostname(),
      setupVersion: '1.9.9',
    };
    writeFileSync(lockPath, JSON.stringify(fixture, null, 2));

    const result = await acquireLock(lockPath, '2.0.0');
    expect(result.kind).toBe('acquired');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('reclaiming stale lockfile'),
    );
  });

  it('reclaims when the lockfile body is unparseable JSON', async () => {
    const lockPath = freshLockPath();
    const seed = await acquireLock(lockPath, '0.0.0');
    if (seed.kind !== 'acquired') throw new Error('seed acquire failed');
    await seed.release();
    writeFileSync(lockPath, '{ this is : not, json');

    const result = await acquireLock(lockPath, '2.0.0');
    expect(result.kind).toBe('acquired');
    const body = JSON.parse(readFileSync(lockPath, 'utf8')) as LockFile;
    expect(body.pid).toBe(process.pid);
  });

  it('reclaims when the JSON is well-formed but missing required fields', async () => {
    const lockPath = freshLockPath();
    const seed = await acquireLock(lockPath, '0.0.0');
    if (seed.kind !== 'acquired') throw new Error('seed acquire failed');
    await seed.release();
    writeFileSync(lockPath, JSON.stringify({ pid: 'not-a-number' }));

    const result = await acquireLock(lockPath, '2.0.0');
    expect(result.kind).toBe('acquired');
  });

  it('reclaims when the recorded startedAt does not match ps lstart (PID reuse)', async () => {
    const lockPath = freshLockPath();
    const seed = await acquireLock(lockPath, '0.0.0');
    if (seed.kind !== 'acquired') throw new Error('seed acquire failed');
    await seed.release();

    // Use process.pid (definitely alive) but with a startedAt 6 hours ago —
    // far enough off the real lstart to defeat the ±1s window, but within
    // the 24h wall-clock cap so the staleness branch doesn't preempt.
    const fixture: LockFile = {
      pid: process.pid,
      startedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
      hostname: os.hostname(),
      setupVersion: '1.9.9',
    };
    writeFileSync(lockPath, JSON.stringify(fixture, null, 2));

    const result = await acquireLock(lockPath, '2.0.0');
    expect(result.kind).toBe('acquired');
    const body = JSON.parse(readFileSync(lockPath, 'utf8')) as LockFile;
    expect(body.setupVersion).toBe('2.0.0');
  });

  it('creates the parent directory if it does not exist', async () => {
    const lockPath = freshLockPath();
    // freshLockPath() already includes a `nested/` segment that doesn't exist.
    const result = await acquireLock(lockPath, '2.0.0');
    expect(result.kind).toBe('acquired');
    expect(existsSync(lockPath)).toBe(true);
    if (result.kind === 'acquired') await result.release();
  });
});
