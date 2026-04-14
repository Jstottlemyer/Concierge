// T11.5 shared `gws` subprocess mock harness.
//
// Tests that exercise `runGws` from `src/gws/runner.ts` can install a
// scripted mock binary: when called with certain argv, it emits configured
// stdout/stderr and exits with the configured code. The mock works by:
//
//   1. Creating a temp dir (`/tmp/authtools-mock-<uuid>/`).
//   2. Writing a Node.js runner (`gws-mock-runner.mjs`) that reads a
//      scenarios JSON file, matches argv, and emits the response.
//   3. Writing a tiny shell wrapper `<tmpdir>/gws` that execs
//      `node <runner.mjs> <scenarios.json> <calls.jsonl> -- <argv...>`.
//      This avoids shebang portability issues and keeps the runner pure JS.
//   4. Chmoding the wrapper executable and setting
//      `process.env.CONCIERGE_GWS_BIN` to its path.
//   5. Each call appends a JSONL record (args + stdin + env) to
//      `calls.jsonl` so `calls` can read the history later.
//
// `uninstall()` restores the prior value of `CONCIERGE_GWS_BIN` and removes
// the temp directory. Call it from `afterEach` so successive tests don't
// interfere — and so that tests NOT using the mock still hit the real gws.
//
// The harness is intentionally self-contained: the Node runner script is
// written fresh for each install so there's no cross-test coupling and no
// dependency on the test framework's module resolution at the child's
// invocation time.
//
// Strict-TS notes:
//   - All JSON parse results are narrowed via `unknown`; no `any`.
//   - `node:fs/promises` / `node:path` / `node:os` for portability.

import { mkdtemp, mkdir, rm, writeFile, chmod } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { GWS_BIN_ENV } from '../../src/gws/paths.js';

/** A single expected call pattern and the response it should produce. */
export type GwsCallExpectation = {
  /**
   * Matches the child's argv (excluding the binary path).
   * - `string[]`: exact deep-equal match.
   * - `(args) => boolean`: custom predicate, evaluated inside the harness
   *   process (not the child). We serialize the expectation into the
   *   scenarios file by converting predicate matchers to a placeholder key
   *   and resolving them after the fact when reading `calls`.
   *
   * NOTE: function matchers run against the recorded call history after
   * the child exits. For in-child matching (which determines what the child
   * emits), only exact `string[]` and `'prefix'` variants fire. Tests that
   * need bespoke matching should use exact argv and verify via `calls`.
   */
  matchArgs: readonly string[] | ((args: readonly string[]) => boolean);
  /** Stdout payload. Defaults to `''`. */
  stdout?: string;
  /** Stderr payload. Defaults to `''`. */
  stderr?: string;
  /** Exit code. Defaults to 0. */
  exitCode?: number;
  /** Sleep before emitting output (milliseconds). Defaults to 0. */
  delayMs?: number;
};

/** Options passed to `installGwsMock`. */
export type GwsMockOptions = {
  /** Scenarios evaluated top-to-bottom; first match wins (unless `strictOrder`). */
  scenarios: readonly GwsCallExpectation[];
  /**
   * When true, the Nth call must match the Nth scenario. If argv doesn't
   * line up, the mock emits `fallbackExitCode` with a stderr explaining the
   * mismatch. Defaults to false.
   */
  strictOrder?: boolean;
  /** Exit code emitted when no scenario matches. Defaults to 0 with empty stdout. */
  fallbackExitCode?: number;
  /** Stderr emitted when no scenario matches. Defaults to `''`. */
  fallbackStderr?: string;
};

/** Recorded information about a single call the mock received. */
export type GwsCallRecord = {
  readonly args: readonly string[];
  readonly stdinReceived: string;
  readonly envReceived: Readonly<Record<string, string>>;
  readonly timestamp: number;
};

/** Handle returned by `installGwsMock`. */
export type InstalledGwsMock = {
  /** Restore env + delete temp dir. Safe to call multiple times. */
  uninstall: () => Promise<void>;
  /** All calls recorded so far (fresh read each access). */
  readonly calls: GwsCallRecord[];
  /** Convenience counter. */
  getCallCount: () => number;
  /** Drop the in-memory and on-disk call history. Does not change scenarios. */
  reset: () => void;
  /** Path to the mock binary (for debugging / assertions). */
  readonly binPath: string;
  /** Path to the temp directory holding the scripts and logs. */
  readonly tmpDir: string;
};

/** Serializable form of an expectation (functions can't cross process bounds). */
type SerializedExpectation = {
  matchType: 'exact';
  args: readonly string[];
  stdout: string;
  stderr: string;
  exitCode: number;
  delayMs: number;
};

type ScenariosFile = {
  scenarios: readonly SerializedExpectation[];
  strictOrder: boolean;
  fallbackExitCode: number;
  fallbackStderr: string;
};

/**
 * Install the mock. Writes a temp Node runner + shell wrapper, points
 * `CONCIERGE_GWS_BIN` at the wrapper, and returns a handle.
 *
 * The caller MUST invoke `uninstall()` in `afterEach` to avoid leaking the
 * env var to sibling tests.
 */
export async function installGwsMock(options: GwsMockOptions): Promise<InstalledGwsMock> {
  const tmpBase = await mkdtemp(path.join(os.tmpdir(), 'authtools-mock-'));
  const tmpDir = path.resolve(tmpBase);
  const runnerPath = path.join(tmpDir, 'gws-mock-runner.mjs');
  const scenariosPath = path.join(tmpDir, 'scenarios.json');
  const callsPath = path.join(tmpDir, 'calls.jsonl');
  const binPath = path.join(tmpDir, 'gws');

  // Serialize scenarios. Function matchers survive as an
  // `'___UNMATCHABLE_PREDICATE_PLACEHOLDER___'` sentinel in the child file —
  // the in-child dispatcher only understands exact argv lists. Tests that
  // need bespoke matching should use exact argv + assert via `calls` after.
  const serialized: SerializedExpectation[] = options.scenarios.map((s) => {
    if (typeof s.matchArgs === 'function') {
      return {
        matchType: 'exact' as const,
        args: ['___UNMATCHABLE_PREDICATE_PLACEHOLDER___'],
        stdout: s.stdout ?? '',
        stderr: s.stderr ?? '',
        exitCode: s.exitCode ?? 0,
        delayMs: s.delayMs ?? 0,
      };
    }
    return {
      matchType: 'exact' as const,
      args: [...s.matchArgs],
      stdout: s.stdout ?? '',
      stderr: s.stderr ?? '',
      exitCode: s.exitCode ?? 0,
      delayMs: s.delayMs ?? 0,
    };
  });

  const scenariosFile: ScenariosFile = {
    scenarios: serialized,
    strictOrder: options.strictOrder ?? false,
    fallbackExitCode: options.fallbackExitCode ?? 0,
    fallbackStderr: options.fallbackStderr ?? '',
  };

  await mkdir(tmpDir, { recursive: true });
  await writeFile(scenariosPath, JSON.stringify(scenariosFile, null, 2), 'utf8');
  await writeFile(callsPath, '', 'utf8');
  await writeFile(runnerPath, RUNNER_SOURCE, 'utf8');

  // Shell wrapper: exec node <runner.mjs> <scenarios> <calls-log> -- <argv...>
  const nodeBin = process.execPath;
  const wrapper =
    `#!/bin/sh\n` +
    `exec "${nodeBin}" "${runnerPath}" "${scenariosPath}" "${callsPath}" -- "$@"\n`;
  await writeFile(binPath, wrapper, 'utf8');
  await chmod(binPath, 0o755);

  const priorBin = process.env[GWS_BIN_ENV];
  process.env[GWS_BIN_ENV] = binPath;

  let uninstalled = false;
  const uninstall = async (): Promise<void> => {
    if (uninstalled) return;
    uninstalled = true;
    if (priorBin === undefined) {
      delete process.env[GWS_BIN_ENV];
    } else {
      process.env[GWS_BIN_ENV] = priorBin;
    }
    await rm(tmpDir, { recursive: true, force: true });
  };

  const readCalls = (): GwsCallRecord[] => readCallsSync(callsPath);

  const reset = (): void => {
    // Synchronous truncate for simplicity; the file is tiny. Exposed as sync
    // to mirror Vitest's `beforeEach` style without forcing tests to await.
    writeFileSync(callsPath, '', 'utf8');
  };

  return {
    uninstall,
    get calls(): GwsCallRecord[] {
      return readCalls();
    },
    getCallCount: (): number => readCalls().length,
    reset,
    binPath,
    tmpDir,
  };
}

function readCallsSync(callsPath: string): GwsCallRecord[] {
  // Synchronous read so the `calls` getter can be ergonomic.
  let text: string;
  try {
    text = readFileSync(callsPath, 'utf8');
  } catch {
    return [];
  }
  if (text.length === 0) return [];
  const records: GwsCallRecord[] = [];
  for (const line of text.split('\n')) {
    if (line.length === 0) continue;
    const parsed = safeParseCallRecord(line);
    if (parsed !== null) records.push(parsed);
  }
  return records;
}

function safeParseCallRecord(line: string): GwsCallRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (raw === null || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const args = obj['args'];
  const stdin = obj['stdinReceived'];
  const env = obj['envReceived'];
  const ts = obj['timestamp'];
  if (!Array.isArray(args)) return null;
  if (typeof stdin !== 'string') return null;
  if (env === null || typeof env !== 'object') return null;
  if (typeof ts !== 'number') return null;
  const argsOk: string[] = [];
  for (const a of args) {
    if (typeof a !== 'string') return null;
    argsOk.push(a);
  }
  const envOk: Record<string, string> = {};
  for (const [k, v] of Object.entries(env as Record<string, unknown>)) {
    if (typeof v === 'string') envOk[k] = v;
  }
  return {
    args: argsOk,
    stdinReceived: stdin,
    envReceived: envOk,
    timestamp: ts,
  };
}

// ---------------------------------------------------------------------------
// Runner source: written verbatim into the temp dir. Kept in-file so there's
// no build-time copy step or cross-module dependency at child invocation.
// The child Node runs this against its own stdlib; it does not import from
// the test suite. It accepts:
//   argv[2] = scenarios JSON path
//   argv[3] = calls log path
//   argv[4] = literal "--"
//   argv[5..] = the actual argv passed to the fake `gws`
// ---------------------------------------------------------------------------
const RUNNER_SOURCE = `#!/usr/bin/env node
// Generated by tests/helpers/gws-mock.ts. Do not edit by hand.
import { readFileSync, appendFileSync } from 'node:fs';

const [,, scenariosPath, callsPath, dashdash, ...childArgs] = process.argv;
if (dashdash !== '--') {
  process.stderr.write('gws-mock-runner: expected -- separator\\n');
  process.exit(2);
}

const scenariosFile = JSON.parse(readFileSync(scenariosPath, 'utf8'));
const scenarios = scenariosFile.scenarios;
const strictOrder = Boolean(scenariosFile.strictOrder);
const fallbackExit = Number(scenariosFile.fallbackExitCode ?? 0);
const fallbackStderr = String(scenariosFile.fallbackStderr ?? '');

function argsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function countCalls() {
  try {
    const text = readFileSync(callsPath, 'utf8');
    if (text.length === 0) return 0;
    return text.split('\\n').filter(l => l.length > 0).length;
  } catch {
    return 0;
  }
}

// Read stdin synchronously. Use the fd-0 readFileSync idiom.
let stdin = '';
try {
  stdin = readFileSync(0, 'utf8');
} catch {
  stdin = '';
}

// Log env as a flat string-map. Filter out undefined.
const envSnapshot = {};
for (const [k, v] of Object.entries(process.env)) {
  if (typeof v === 'string') envSnapshot[k] = v;
}

const callRecord = {
  args: childArgs,
  stdinReceived: stdin,
  envReceived: envSnapshot,
  timestamp: Date.now(),
};
appendFileSync(callsPath, JSON.stringify(callRecord) + '\\n', 'utf8');

let matched = null;
if (strictOrder) {
  const idx = countCalls() - 1; // we just appended above
  if (idx >= 0 && idx < scenarios.length) {
    const candidate = scenarios[idx];
    if (argsEqual(candidate.args, childArgs)) {
      matched = candidate;
    }
  }
} else {
  for (const s of scenarios) {
    if (argsEqual(s.args, childArgs)) {
      matched = s;
      break;
    }
  }
}

function emit(stdout, stderr, code, delayMs) {
  const go = () => {
    if (stdout.length > 0) process.stdout.write(stdout);
    if (stderr.length > 0) process.stderr.write(stderr);
    process.exit(code);
  };
  if (delayMs > 0) setTimeout(go, delayMs);
  else go();
}

if (matched === null) {
  const msg = fallbackStderr.length > 0
    ? fallbackStderr
    : (strictOrder
        ? 'gws-mock: strict-order mismatch for argv: ' + JSON.stringify(childArgs) + '\\n'
        : '');
  emit('', msg, fallbackExit, 0);
} else {
  emit(
    String(matched.stdout ?? ''),
    String(matched.stderr ?? ''),
    Number(matched.exitCode ?? 0),
    Number(matched.delayMs ?? 0),
  );
}
`;
