// T10: concurrent OAuth detect-and-defer via pidfile probe.
//
// Plan Decision #9 trusts gws's own file locking to serialise the actual auth
// flow; this module layers a best-effort probe on top so the MCP server can
// short-circuit with a friendly `auth_in_progress` envelope instead of spawning
// a second `gws auth login` that races with a user already mid-consent.
//
// Reality check: we don't know for certain that gws writes a pidfile. The
// spike notes referenced `~/.config/gws/auth.pid` but actual behaviour is
// uncertain. The probe therefore tries three strategies in decreasing order
// of reliability and returns `false` if none produce evidence:
//
//   1. Pidfile at `<configDir>/auth.pid` — read, parse, verify liveness.
//   2. Process-list scan — `ps -eo pid,command` filtered for gws+auth lines,
//      excluding the current process.
//   3. Lock-file presence — `<configDir>/credentials.enc.lock`.
//
// Tuning bias: **false positives are worse than false negatives** per the task
// spec. If gws already handles concurrent logins (fresh loopback ports, etc.)
// a missed detection costs at most an extra browser tab; a false detection
// gives the user a confusing "already in progress" error when nothing is
// actually running. Every strategy therefore requires positive evidence.
//
// Safety:
//   - No shell invocation — `spawn('ps', [...], { shell: false })`.
//   - Bounded runtime — `ps` has a 2s AbortController timeout.
//   - All strategies catch + swallow their own errors; a probe failure must
//     never propagate up and block auth. Warnings go to stderr as single
//     lines (no stack traces) so noisy envs don't flood logs.

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { GWS_CONFIG_DIR_ENV } from '../gws/paths.js';

/** Options controlling the probe. Most callers pass nothing. */
export interface PidfileProbeOptions {
  /** Override the gws config dir. Defaults to `GOOGLE_WORKSPACE_CLI_CONFIG_DIR`
   *  then `~/.config/gws/`. */
  readonly configDir?: string;
  /** Skip the `ps` scan. Tests set this so they don't race with system processes. */
  readonly skipProcessList?: boolean;
  /** Timeout for the `ps` spawn (ms). Default 2s. */
  readonly psTimeoutMs?: number;
}

/** Matches the T9 `AuthInProgressProbe` interface. */
export type AuthInProgressProbe = () => Promise<boolean>;

/** Default pidfile name gws is expected to (maybe) write. */
const PIDFILE_NAME = 'auth.pid';

/** Default lock file gws would use if it locks the credentials store. */
const LOCKFILE_NAME = 'credentials.enc.lock';

/** Default timeout for the ps fallback. */
const DEFAULT_PS_TIMEOUT_MS = 2_000;

/**
 * Probe whether an OAuth flow is already running on this machine.
 *
 * Returns `true` only if we have positive evidence. Any internal error
 * (missing file, ps unavailable, permission denied) falls through to the
 * next strategy or to `false`.
 */
export async function authInProgressProbe(options?: PidfileProbeOptions): Promise<boolean> {
  const configDir = options?.configDir ?? resolveConfigDirForProbe();

  // Strategy 1: pidfile.
  const pidfilePath = path.join(configDir, PIDFILE_NAME);
  const pid = await readPidfile(pidfilePath);
  if (pid !== null && isProcessAlive(pid)) {
    return true;
  }

  // Strategy 2: process-list scan.
  if (options?.skipProcessList !== true) {
    const found = await findGwsAuthProcess(options?.psTimeoutMs ?? DEFAULT_PS_TIMEOUT_MS);
    if (found) {
      return true;
    }
  }

  // Strategy 3: credentials lockfile.
  if (await lockfilePresent(path.join(configDir, LOCKFILE_NAME))) {
    return true;
  }

  return false;
}

/**
 * Read a pidfile and return the integer PID on success. Returns `null` for
 * missing files, empty files, non-integer bodies, or any read error.
 *
 * Exposed for unit testing.
 */
export async function readPidfile(pidfilePath: string): Promise<number | null> {
  let raw: string;
  try {
    raw = await readFile(pidfilePath, 'utf8');
  } catch {
    return null;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // `parseInt` accepts `'42abc'` so validate with a strict regex first.
  if (!/^\d+$/.test(trimmed)) return null;
  const pid = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(pid) || pid <= 0) return null;
  return pid;
}

/**
 * Check whether a PID refers to a live process on this host.
 *
 * Uses the standard Node pattern: `process.kill(pid, 0)` sends no signal but
 * throws `ESRCH` when the target doesn't exist and `EPERM` when it exists but
 * belongs to another user. We treat both "no error" and `EPERM` as "alive"
 * because an EPERM response still proves the PID is in use.
 */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    // EPERM => process exists but we can't signal it (different user). Still
    // counts as "alive" for our purposes.
    if (code === 'EPERM') return true;
    return false;
  }
}

/**
 * Scan the process table for an in-flight `gws auth login` (or any `gws auth`
 * command — consent flows can show up under other subcommands). Returns
 * `true` only when a matching non-self process is found.
 *
 * Implemented via `spawn('ps', ['-eo', 'pid,command'], { shell: false })`
 * so no shell interpretation ever happens. `ps` is POSIX on macOS and Linux;
 * if it is unavailable or errors, we return `false` (with a single-line
 * stderr warning).
 */
export async function findGwsAuthProcess(timeoutMs: number = DEFAULT_PS_TIMEOUT_MS): Promise<boolean> {
  const output = await runPsListing(timeoutMs);
  if (output === null) return false;

  const selfPid = process.pid;
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    // Expected layout: "<pid> <command...>". Split once on whitespace.
    const spaceIdx = trimmed.indexOf(' ');
    if (spaceIdx <= 0) continue;
    const pidStr = trimmed.slice(0, spaceIdx);
    const command = trimmed.slice(spaceIdx + 1);
    if (!/^\d+$/.test(pidStr)) continue; // header line "PID COMMAND" skipped
    const pid = Number.parseInt(pidStr, 10);
    if (pid === selfPid) continue;

    // Look for gws + auth in the command line. We deliberately do not require
    // an exact `gws auth login` string — `gws auth setup` or similar consent
    // flows should also defer. Word-boundaries avoid matching "gwsauthority"
    // or similar noise.
    if (/\bgws\b/i.test(command) && /\bauth\b/i.test(command)) {
      return true;
    }
  }
  return false;
}

/** Resolve the gws config dir for the probe (env override > ~/.config/gws). */
function resolveConfigDirForProbe(): string {
  const override = process.env[GWS_CONFIG_DIR_ENV];
  if (override !== undefined && override.length > 0) {
    return path.resolve(override);
  }
  return path.join(os.homedir(), '.config', 'gws');
}

/**
 * Check for a credentials-file lock. Presence alone is enough — we don't
 * verify that it's a fresh lock, because stale lock files are already a
 * failure mode we'd want the user to see ("clean this up and retry").
 *
 * Returns `false` if the file doesn't exist or we can't stat it.
 */
async function lockfilePresent(lockPath: string): Promise<boolean> {
  try {
    await readFile(lockPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Spawn `ps -eo pid,command` and return stdout on success, `null` on any
 * failure (missing binary, non-zero exit, timeout). Does not throw.
 */
async function runPsListing(timeoutMs: number): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    let child;
    try {
      child = spawn('ps', ['-eo', 'pid,command'], {
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        signal: controller.signal,
      });
    } catch (err: unknown) {
      clearTimeout(timeoutHandle);
      warnOnce('pidfile-probe: unable to spawn ps', err);
      resolve(null);
      return;
    }

    const stdoutChunks: Buffer[] = [];
    let settled = false;

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    child.on('error', (err: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      // AbortError + genuine errors both end up here; treat both as "no data"
      // rather than noisy failures. Don't log AbortError — a slow ps isn't
      // interesting enough to warrant stderr noise.
      const name = (err as { name?: string } | undefined)?.name;
      if (name !== 'AbortError' && !controller.signal.aborted) {
        warnOnce('pidfile-probe: ps errored', err);
      }
      resolve(null);
    });

    child.on('close', (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      if (controller.signal.aborted || code !== 0) {
        resolve(null);
        return;
      }
      resolve(Buffer.concat(stdoutChunks).toString('utf8'));
    });
  });
}

/**
 * Single-line stderr warning. Kept deliberately terse so a degraded host
 * doesn't flood logs. No stack traces.
 */
function warnOnce(message: string, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err);
  process.stderr.write(`[concierge] ${message}: ${detail}\n`);
}

/**
 * Convenience wrapper matching T9's `AuthInProgressProbe` interface. Pass
 * this directly to the auto-consent flow when no custom options are needed.
 */
export const defaultAuthInProgressProbe: AuthInProgressProbe = () => authInProgressProbe();
