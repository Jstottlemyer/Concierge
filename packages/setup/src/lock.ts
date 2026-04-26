// B3: Single-instance lockfile for the orchestrator.
//
// Concierge-setup must not run concurrently — two probe phases racing each
// other against the same Homebrew/gws/Claude state would produce undefined
// results. We coordinate via a JSON lockfile at a caller-chosen absolute path
// (typically `~/.config/concierge/setup.lock`).
//
// Implementation notes
// --------------------
// - Pure Node, no external deps. macOS does not ship `flock(1)` by default,
//   so a process-level approach (`fs.openSync(path, 'wx')`) is the portable
//   primitive. `wx` is atomic at the syscall layer (O_CREAT|O_EXCL).
// - On `EEXIST` we read the recorded `pid + startedAt + hostname` and apply
//   four reclaim policies:
//     1. JSON parse failure       → reclaim (corrupt lockfile)
//     2. Cross-host hostname      → reclaim (stale NFS-mounted home)
//     3. Wall-clock age > 24h     → reclaim with warning (orphaned long-runner)
//     4. PID liveness check fails → reclaim (process died without cleanup)
//     5. PID alive but `ps -o lstart` mismatches recorded `startedAt`
//                                 → reclaim (PID-reuse race)
//   Otherwise return `blocked` with the live holder's recorded info.
// - `release()` deletes the lockfile *only if* the recorded PID matches our
//   own; otherwise it is a no-op (defensive against races where another
//   process reclaimed our lock as stale). It is idempotent and never throws
//   on missing file.
// - The acquire path registers a `process.on('exit', ...)` handler so
//   crash-only callers still clean up on graceful exit. Async cleanup in
//   'exit' is impossible (Node ignores I/O), so we use the sync `unlinkSync`
//   inside the exit handler and the async `release()` for explicit cleanup.

import { execFileSync } from 'node:child_process';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import * as os from 'node:os';
import { dirname } from 'node:path';

import type { LockFile } from './types/lock.js';

export interface AcquireResult {
  kind: 'acquired';
  /** Idempotent; safe to call multiple times. Never throws on missing file. */
  release: () => Promise<void>;
}

export interface BlockedResult {
  kind: 'blocked';
  /** Recorded info for the live PID currently holding the lock. */
  holder: LockFile;
}

export type LockResult = AcquireResult | BlockedResult;

const STALE_WALL_CLOCK_MS = 24 * 60 * 60 * 1000;

/**
 * Attempt to acquire the orchestrator lock.
 *
 * @param lockfileAbsPath Absolute path of the JSON lockfile (e.g.
 *                        `~/.config/concierge/setup.lock`). The parent
 *                        directory is created with `mkdirSync(..., {recursive})`
 *                        if missing.
 * @param setupVersion    Version string baked into the LockFile body, surfaced
 *                        to the user by the lock-collision UI screen.
 * @returns               `acquired` (with a `release()` function) on success,
 *                        or `blocked` with the live holder's recorded info.
 */
export async function acquireLock(
  lockfileAbsPath: string,
  setupVersion: string,
): Promise<LockResult> {
  mkdirSync(dirname(lockfileAbsPath), { recursive: true });

  // Single retry budget after a reclaim — one extra openSync('wx') attempt is
  // enough because reclaim is single-threaded relative to ourselves; if a
  // *third* party also raced in, returning blocked is the correct answer.
  for (let attempt = 0; attempt < 2; attempt++) {
    const acquired = tryCreate(lockfileAbsPath, setupVersion);
    if (acquired) return acquired;

    const inspection = inspectExistingLock(lockfileAbsPath);
    if (inspection.kind === 'reclaim') {
      // Best-effort delete; ignore if it raced away.
      try {
        unlinkSync(lockfileAbsPath);
      } catch {
        /* already gone */
      }
      continue;
    }
    return { kind: 'blocked', holder: inspection.holder };
  }

  // Could not reclaim + acquire after one retry — treat the second EEXIST as
  // a real concurrent holder. Re-inspect to surface the live holder info.
  const finalInspection = inspectExistingLock(lockfileAbsPath);
  if (finalInspection.kind === 'live') {
    return { kind: 'blocked', holder: finalInspection.holder };
  }
  // Degenerate fallback: synthesize a minimal holder record. Shouldn't happen
  // in practice (the file *was* there for inspection to even run), but keeps
  // the return type total.
  return {
    kind: 'blocked',
    holder: {
      pid: -1,
      startedAt: new Date(0).toISOString(),
      hostname: os.hostname(),
      setupVersion,
    },
  };
}

interface LiveLock {
  kind: 'live';
  holder: LockFile;
}
interface ReclaimLock {
  kind: 'reclaim';
}

function inspectExistingLock(lockfileAbsPath: string): LiveLock | ReclaimLock {
  let raw: string;
  try {
    raw = readFileSync(lockfileAbsPath, 'utf8');
  } catch {
    // File vanished between EEXIST and read — treat as reclaimable; the next
    // openSync('wx') will likely succeed.
    return { kind: 'reclaim' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'reclaim' };
  }

  if (!isLockFile(parsed)) return { kind: 'reclaim' };

  // Cross-host: NFS-mounted home directories can leave stale lockfiles from
  // other machines. We can't probe their PIDs, so trust the hostname mismatch.
  if (parsed.hostname !== os.hostname()) {
    return { kind: 'reclaim' };
  }

  // Wall-clock staleness: a 24h-old "live" lock almost certainly indicates an
  // orphan, even if the PID got reused into something long-lived.
  const startedAtMs = Date.parse(parsed.startedAt);
  if (
    !Number.isNaN(startedAtMs) &&
    Date.now() - startedAtMs > STALE_WALL_CLOCK_MS
  ) {
    console.warn(
      `[concierge-setup] reclaiming stale lockfile (age > 24h) at ${lockfileAbsPath}`,
    );
    return { kind: 'reclaim' };
  }

  // PID liveness: ESRCH ⇒ definitely dead. EPERM ⇒ alive but not ours
  // (treat as live; user might be running as a different uid).
  if (!isPidAlive(parsed.pid)) return { kind: 'reclaim' };

  // PID-reuse defeat: same PID number could be a different process. Compare
  // `ps -o lstart` (process start time) against the recorded `startedAt`,
  // both rounded to the second.
  const recordedSec = Math.floor(startedAtMs / 1000);
  const liveSec = readLstartEpochSec(parsed.pid);
  if (liveSec === null) {
    // ps disappeared the process between kill(0) and ps. Treat as dead.
    return { kind: 'reclaim' };
  }
  if (Math.abs(liveSec - recordedSec) > 1) {
    return { kind: 'reclaim' };
  }

  return { kind: 'live', holder: parsed };
}

function tryCreate(
  lockfileAbsPath: string,
  setupVersion: string,
): AcquireResult | null {
  let fd: number;
  try {
    fd = openSync(lockfileAbsPath, 'wx');
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'EEXIST') return null;
    throw err;
  }

  const ownerPid = process.pid;
  const body: LockFile = {
    pid: ownerPid,
    startedAt: new Date().toISOString(),
    hostname: os.hostname(),
    setupVersion,
  };
  const payload = JSON.stringify(body, null, 2);
  try {
    writeSync(fd, payload);
  } finally {
    closeSync(fd);
  }

  let released = false;
  const releaseSync = (): void => {
    if (released) return;
    released = true;
    try {
      const raw = readFileSync(lockfileAbsPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (isLockFile(parsed) && parsed.pid !== ownerPid) {
        // Another process reclaimed it; leave it alone.
        return;
      }
    } catch {
      // Missing or unparseable — fall through to unlink attempt; unlink will
      // no-op cleanly if the file is already gone.
    }
    try {
      unlinkSync(lockfileAbsPath);
    } catch (err: unknown) {
      if (isNodeError(err) && err.code === 'ENOENT') return;
      // Swallow — release must not throw on cleanup.
    }
  };

  process.on('exit', releaseSync);

  return {
    kind: 'acquired',
    release: async () => {
      releaseSync();
      // Drop the exit handler we registered so callers that acquire many
      // locks in one process (e.g. test suites) don't leak listeners and
      // trip Node's MaxListenersExceededWarning at 11+ acquires.
      process.removeListener('exit', releaseSync);
      // Async signature is honored even though releaseSync is sync — keeps
      // the contract future-proof if release ever needs to await something.
      await Promise.resolve();
    },
  };
}

function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    if (isNodeError(err)) {
      // EPERM = process exists but we can't signal it (different uid). Alive.
      if (err.code === 'EPERM') return true;
      // ESRCH = no such process.
      if (err.code === 'ESRCH') return false;
    }
    return false;
  }
}

/**
 * Read the start time of `pid` via `ps -o lstart=`. Returns the epoch seconds
 * of the process's start, or null if `ps` could not report on the PID.
 *
 * `lstart` format on macOS / BSD: `Sat Apr 18 10:23:45 2026` (locale-fixed).
 */
function readLstartEpochSec(pid: number): number | null {
  let stdout: string;
  try {
    stdout = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
  const trimmed = stdout.trim();
  if (trimmed === '') return null;
  const ms = Date.parse(trimmed);
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 1000);
}

function isLockFile(value: unknown): value is LockFile {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['pid'] === 'number' &&
    typeof v['startedAt'] === 'string' &&
    typeof v['hostname'] === 'string' &&
    typeof v['setupVersion'] === 'string'
  );
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string'
  );
}
