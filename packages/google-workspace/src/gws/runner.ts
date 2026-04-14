// Subprocess runner for the bundled `gws` CLI.
//
// Decision #6 (subprocess safety), Decision #9 (fresh subprocess per call),
// Decision #11 (binary integrity) converge here:
//   - Every invocation uses `spawn(bin, argv, { shell: false })`. No shell
//     interpolation, no `exec*` variants.
//   - Caller supplies a complete argv array; we never build one from strings.
//   - Stdout and stderr are captured in full, then passed through `redactString`
//     before returning. Defense-in-depth: gws should not leak tokens into
//     stderr, but we scrub anyway.
//   - A 30s default timeout fires via `AbortController`; on timeout we surface
//     `exitCode: -1` + `signal: 'SIGTERM'` rather than throwing, so callers can
//     decide whether to translate to `network_error` with a `retry_after_ms`.
//   - ENOENT / EACCES during spawn throws `ConciergeError('gws_error')` with
//     redacted stderr. This is the only path that throws.
//   - `gws --version` is memoised per process (Decision #9: "only --version is
//     cached"). `__resetVersionCacheForTests()` is exported for test isolation.
//
// This module does not translate exit codes into user-facing envelopes — see
// `./errors.ts` for `toolErrorFromGwsResult`. Runner's contract is: run the
// child, return what happened. Policy lives one layer up.

import { spawn } from 'node:child_process';

import { ConciergeError } from '@concierge/core/errors';
import { redactString } from '../log/redact.js';
import { resolveGwsBinary } from './paths.js';

/** Default timeout for a single `gws` invocation (milliseconds). */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** Synthetic exit code emitted when we abort the child via timeout. */
export const TIMEOUT_EXIT_CODE = -1;

/** Synthetic signal string paired with the timeout exit code. */
export const TIMEOUT_SIGNAL = 'SIGTERM';

/** Optional per-invocation overrides for the runner. */
export interface RunOptions {
  /** Override the default 30s timeout. */
  readonly timeoutMs?: number;
  /** Bytes to write to the child's stdin before closing it. */
  readonly stdin?: string;
  /** Extra env vars merged on top of `process.env`. Do not set here anything
   *  that gws reads for auth (`GOOGLE_APPLICATION_CREDENTIALS`, etc.). */
  readonly env?: Readonly<Record<string, string>>;
}

/** Structured result returned for every run (success or non-zero exit). */
export interface RunResult {
  readonly exitCode: number;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly gwsVersion: string;
}

/** Module-local cache for `gws --version`. Reset with the exported test helper. */
let cachedVersion: string | null = null;

/**
 * Test-only helper: drop the cached `gws --version` string so the next call
 * re-invokes the subprocess. Exported so test suites can isolate fixtures
 * without spawning a new Node process.
 */
export function __resetVersionCacheForTests(): void {
  cachedVersion = null;
}

/**
 * Spawn `gws <...args>` once. Returns a `RunResult` describing what happened.
 *
 * Contract:
 *   - Non-zero exit codes are returned, not thrown. Callers inspect `exitCode`.
 *   - Timeouts surface as `{ exitCode: -1, signal: 'SIGTERM' }`.
 *   - ENOENT / EACCES during spawn throws `ConciergeError('gws_error')`. All
 *     other spawn-time errors (EPERM, ENOMEM, ...) also throw with the same
 *     code; the error message is redacted.
 *   - `gws --version` is called once per process and cached. If the caller
 *     passes `['--version']` directly, we do not double-spawn — the raw result
 *     is returned and the cache is populated from its stdout.
 *
 * The returned `gwsVersion` is always populated. If the runner cannot
 * discover the version (e.g. the user invoked a version command that itself
 * failed), the field is `'unknown'` rather than empty — callers logging the
 * version always have something to print.
 */
export async function runGws(args: readonly string[], options?: RunOptions): Promise<RunResult> {
  const isVersionProbe = args.length === 1 && args[0] === '--version';

  // Get the version up-front unless this IS the version call.
  let version = 'unknown';
  if (!isVersionProbe) {
    version = await getGwsVersion();
  }

  const result = await runSpawn(args, options);
  const resultWithVersion: RunResult = {
    exitCode: result.exitCode,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
    durationMs: result.durationMs,
    gwsVersion: version,
  };

  if (isVersionProbe && result.exitCode === 0) {
    const parsed = parseVersionLine(result.stdout);
    // Cache only on success. Partial populate: if stdout doesn't match the
    // expected shape we still hand the raw stdout back to the caller.
    if (parsed !== null) {
      cachedVersion = parsed;
      return {
        exitCode: result.exitCode,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr,
        durationMs: result.durationMs,
        gwsVersion: parsed,
      };
    }
  }

  return resultWithVersion;
}

/**
 * Return the cached `gws --version` string, invoking the binary on the first
 * call. Cache persists for the lifetime of the Node process; reset with
 * `__resetVersionCacheForTests()` for test isolation.
 *
 * On failure (non-zero exit, spawn error, malformed output): propagates the
 * error and does NOT cache. Subsequent calls will retry.
 */
export async function getGwsVersion(): Promise<string> {
  if (cachedVersion !== null) {
    return cachedVersion;
  }

  const result = await runSpawn(['--version']);
  if (result.exitCode !== 0) {
    throw new ConciergeError(
      'gws_error',
      `gws --version exited with code ${String(result.exitCode)}: ${result.stderr}`,
      { details: { exit_code: result.exitCode, stderr: result.stderr } },
    );
  }

  const parsed = parseVersionLine(result.stdout);
  if (parsed === null) {
    throw new ConciergeError(
      'gws_error',
      `gws --version returned unrecognized output: ${result.stdout.slice(0, 200)}`,
    );
  }

  cachedVersion = parsed;
  return parsed;
}

/**
 * Extract the version string from a `gws --version` stdout payload. Returns
 * the whole trimmed first line when it looks like `gws <version>`; returns
 * `null` if the shape is unrecognizable. Tolerant of the common forms:
 *   `gws 0.22.5`
 *   `gws 0.22.5-fake`
 *   `gws version 0.22.5`
 */
function parseVersionLine(stdout: string): string | null {
  const firstLine = stdout.split('\n')[0]?.trim() ?? '';
  if (firstLine.length === 0) return null;
  // Accept anything that starts with `gws` — the full line is the "version"
  // string we surface. Callers log it verbatim.
  if (!/^gws\b/i.test(firstLine)) return null;
  return firstLine;
}

interface SpawnResult {
  readonly exitCode: number;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

/**
 * Low-level spawn wrapper. Does not consult or populate the version cache;
 * that's the caller's job.
 */
async function runSpawn(args: readonly string[], options?: RunOptions): Promise<SpawnResult> {
  const bin = resolveGwsBinary();
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  const startedAt = Date.now();

  return new Promise<SpawnResult>((resolve, reject) => {
    const childEnv: NodeJS.ProcessEnv = options?.env !== undefined
      ? { ...process.env, ...options.env }
      : process.env;

    const child = spawn(bin, [...args], {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      signal: controller.signal,
      env: childEnv,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    // Write optional stdin and close the pipe. Any failure to write is
    // surfaced as a spawn-time gws_error below.
    if (options?.stdin !== undefined) {
      child.stdin.end(options.stdin, 'utf8');
    } else {
      child.stdin.end();
    }

    let settled = false;

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);

      // Abort-triggered errors come through as AbortError; translate to a
      // timeout RunResult rather than throwing.
      if (err.name === 'AbortError' || controller.signal.aborted) {
        const stdout = redactString(Buffer.concat(stdoutChunks).toString('utf8'));
        const stderr = redactString(Buffer.concat(stderrChunks).toString('utf8'));
        resolve({
          exitCode: TIMEOUT_EXIT_CODE,
          signal: TIMEOUT_SIGNAL,
          stdout,
          stderr,
          durationMs: Date.now() - startedAt,
        });
        return;
      }

      const rawStderr = Buffer.concat(stderrChunks).toString('utf8');
      reject(
        new ConciergeError(
          'gws_error',
          `failed to spawn gws (${err.code ?? 'UNKNOWN'}): ${redactString(err.message)}`,
          {
            details: {
              errno_code: err.code ?? null,
              stderr: redactString(rawStderr).slice(-500),
            },
          },
        ),
      );
    });

    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);

      const stdout = redactString(Buffer.concat(stdoutChunks).toString('utf8'));
      const stderr = redactString(Buffer.concat(stderrChunks).toString('utf8'));

      if (controller.signal.aborted) {
        resolve({
          exitCode: TIMEOUT_EXIT_CODE,
          signal: TIMEOUT_SIGNAL,
          stdout,
          stderr,
          durationMs: Date.now() - startedAt,
        });
        return;
      }

      resolve({
        exitCode: code ?? TIMEOUT_EXIT_CODE,
        signal: signal ?? null,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}
