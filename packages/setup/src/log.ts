// B4: NDJSON setup logger with line-by-line redaction + rotation policy.
//
// Every line written to disk is JSON.stringify()'d, then passed through
// `redactStringForLog` from `@concierge/core/log` (D17 / A3 surface split:
// HARD_LIST + PII patterns, NOT the credential-only `redactString`).
//
// Filename shape: `setup-<ISO-with-colons-as-hyphens>.log`.
//
// Rotation policy (called at the START of `openLogger`, before opening
// the new log file):
//   - List `setup-*.log` in `logsDir` by mtime descending.
//   - Keep top-5 by mtime.
//   - "First failure log" sticky: scan files for any line with
//     `level: "error"`. The most recent such file is preserved even if
//     it would otherwise fall out of the top-5 window. Max 6 retained.
//   - Delete the rest.
//   - Returns `{ kept, deleted }` for testability.
//
// Buffered append for performance; `close()` flushes + releases the FD.

import {
  open as fsOpen,
  mkdir,
  readdir,
  readFile,
  stat,
  unlink,
  type FileHandle,
} from 'node:fs/promises';
import { join } from 'node:path';

import { redactStringForLog } from '@concierge/core/log';

export interface LogLine {
  ts: string; // ISO-8601
  phase: string; // 'probe' | 'install' | 'oauth' | etc. — string for now
  level: 'info' | 'warn' | 'error';
  msg: string;
  data?: unknown;
  schemaVersion: 1; // forward compat
}

export interface SetupLogger {
  info(phase: string, msg: string, data?: unknown): void;
  warn(phase: string, msg: string, data?: unknown): void;
  error(phase: string, msg: string, data?: unknown): void;
  /** Flush + close the underlying FD. Idempotent. */
  close(): Promise<void>;
  /** Absolute path to the current log file. */
  getPath(): string;
}

export interface OpenLoggerOptions {
  logsDir: string; // ~/.config/concierge/setup-logs/
  timestamp?: Date; // defaults to new Date()
}

export interface RotateResult {
  kept: string[];
  deleted: string[];
}

const SCHEMA_VERSION = 1 as const;
const SETUP_LOG_RE = /^setup-.+\.log$/;
const KEEP_RECENT = 5;
const MAX_TOTAL = 6;

/** Build a filename-safe timestamp segment by replacing `:` with `-`. */
function isoForFilename(ts: Date): string {
  return ts.toISOString().replace(/:/g, '-');
}

/**
 * Open a new setup log file. Runs rotation BEFORE opening (so the
 * brand-new file is never a rotation candidate). Returns a logger with
 * synchronous-looking `info/warn/error` methods that buffer writes
 * via an internal queue, plus `close()` which flushes the queue and
 * releases the FD.
 */
export async function openLogger(
  options: OpenLoggerOptions,
): Promise<SetupLogger> {
  const ts = options.timestamp ?? new Date();
  await mkdir(options.logsDir, { recursive: true });

  // Rotate FIRST so the about-to-be-created file isn't in scope.
  await rotateLogs(options.logsDir);

  const filename = `setup-${isoForFilename(ts)}.log`;
  const filepath = join(options.logsDir, filename);

  const handle: FileHandle = await fsOpen(filepath, 'a');

  let closed = false;
  // Single-flight write chain — every enqueue() awaits the previous write,
  // guaranteeing line-order on disk while keeping `info()` fire-and-forget
  // from the caller's perspective. Errors are swallowed deliberately:
  // logging must never crash the orchestrator.
  let chain: Promise<void> = Promise.resolve();

  function enqueue(line: LogLine): void {
    if (closed) return;
    const serialized = JSON.stringify(line);
    const redacted = redactStringForLog(serialized);
    const payload = redacted + '\n';
    chain = chain.then(async () => {
      if (closed) return;
      try {
        await handle.write(payload);
      } catch {
        // swallow — see comment above.
      }
    });
  }

  function makeLine(
    level: LogLine['level'],
    phase: string,
    msg: string,
    data?: unknown,
  ): LogLine {
    const base: LogLine = {
      ts: new Date().toISOString(),
      phase,
      level,
      msg,
      schemaVersion: SCHEMA_VERSION,
    };
    if (data !== undefined) base.data = data;
    return base;
  }

  return {
    info(phase, msg, data) {
      enqueue(makeLine('info', phase, msg, data));
    },
    warn(phase, msg, data) {
      enqueue(makeLine('warn', phase, msg, data));
    },
    error(phase, msg, data) {
      enqueue(makeLine('error', phase, msg, data));
    },
    async close(): Promise<void> {
      if (closed) return;
      // Drain queued writes, THEN flip closed + release FD.
      await chain;
      closed = true;
      try {
        await handle.close();
      } catch {
        // already closed / swallow.
      }
    },
    getPath(): string {
      return filepath;
    },
  };
}

/**
 * Apply rotation policy. See module header for semantics.
 *
 * Implementation:
 *   1. List `setup-*.log` files in `logsDir` (or return empty if dir absent).
 *   2. Stat each → sort by mtime descending.
 *   3. Take top-5 as `keepRecent`.
 *   4. Scan files NOT in keep-set for any line with `"level":"error"`;
 *      the most-recent such file becomes the sticky `firstFailure` candidate.
 *      (We also accept failure logs already in the keep-set — they don't
 *      add to the sticky budget.)
 *   5. Delete all files not in `keepRecent ∪ {firstFailure?}`. Cap at 6.
 */
export async function rotateLogs(logsDir: string): Promise<RotateResult> {
  let entries: string[];
  try {
    entries = await readdir(logsDir);
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      return { kept: [], deleted: [] };
    }
    throw err;
  }

  const candidates = entries.filter((name) => SETUP_LOG_RE.test(name));
  if (candidates.length === 0) return { kept: [], deleted: [] };

  const stats = await Promise.all(
    candidates.map(async (name) => {
      const full = join(logsDir, name);
      const st = await stat(full);
      return { name, full, mtimeMs: st.mtimeMs };
    }),
  );

  // mtime descending = newest first.
  stats.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const keepRecent = stats.slice(0, KEEP_RECENT);
  const keepRecentNames = new Set(keepRecent.map((s) => s.name));

  // Sticky-keep the most-recent failure log if it's NOT in the recent window.
  const candidatesForSticky = stats.filter((s) => !keepRecentNames.has(s.name));
  let stickyName: string | null = null;
  for (const cand of candidatesForSticky) {
    // candidatesForSticky is already mtime-desc, so the first hit wins.
    const hasError = await fileContainsErrorLine(cand.full);
    if (hasError) {
      stickyName = cand.name;
      break;
    }
  }

  const keptSet = new Set(keepRecentNames);
  if (stickyName !== null && keptSet.size < MAX_TOTAL) {
    keptSet.add(stickyName);
  }

  const kept: string[] = [];
  const deleted: string[] = [];
  // Delete in stable order for predictable test output.
  for (const s of stats) {
    if (keptSet.has(s.name)) {
      kept.push(s.full);
    } else {
      try {
        await unlink(s.full);
      } catch {
        // best-effort — concurrent deletion / permission issues should
        // not crash the orchestrator's startup.
      }
      deleted.push(s.full);
    }
  }

  return { kept, deleted };
}

/**
 * Stream-ish scan: read the file as utf8, split on newlines, look for any
 * line that JSON-parses to `{ level: "error", ... }`. We avoid a substring
 * shortcut because a redacted `data` payload could contain `level":"error"`
 * inside a quoted string — and the schema is small enough that JSON.parse
 * per line is cheap. Files that fail to read or parse are treated as
 * non-failure (best-effort).
 */
async function fileContainsErrorLine(filepath: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(filepath, 'utf8');
  } catch {
    return false;
  }
  const lines = raw.split('\n');
  for (const line of lines) {
    if (line.length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'level' in parsed &&
        (parsed as { level: unknown }).level === 'error'
      ) {
        return true;
      }
    } catch {
      // Skip malformed lines; not a failure indicator.
    }
  }
  return false;
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string'
  );
}
