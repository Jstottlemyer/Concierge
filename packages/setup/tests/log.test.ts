// G2 (B4 portion): NDJSON setup-logger tests.
//
// Per task B4: real fs (not memfs). Each test gets its own tmpdir under
// `os.tmpdir()`, so file rotation hits real mtime semantics.

import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openLogger, rotateLogs, type SetupLogger } from '../src/log.js';

let scratch: string;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'concierge-setup-log-'));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

async function readLines(path: string): Promise<unknown[]> {
  const raw = await readFile(path, 'utf8');
  return raw
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as unknown);
}

/** Small helper: write a synthetic setup-*.log with given lines + mtime. */
async function seedLog(
  dir: string,
  filename: string,
  lines: object[],
  mtime: Date,
): Promise<string> {
  const full = join(dir, filename);
  const body = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
  await writeFile(full, body);
  await utimes(full, mtime, mtime);
  return full;
}

describe('openLogger', () => {
  it('writes a valid log file at the expected path with timestamp-derived name', async () => {
    const ts = new Date('2026-04-25T12:34:56.789Z');
    const logger = await openLogger({ logsDir: scratch, timestamp: ts });

    const expected = join(
      scratch,
      'setup-2026-04-25T12-34-56.789Z.log',
    );
    expect(logger.getPath()).toBe(expected);

    logger.info('probe', 'starting');
    await logger.close();

    const entries = await readdir(scratch);
    expect(entries).toContain('setup-2026-04-25T12-34-56.789Z.log');

    const lines = await readLines(expected);
    expect(lines).toHaveLength(1);
  });

  it('info / warn / error all produce valid NDJSON lines with the expected level', async () => {
    const logger = await openLogger({ logsDir: scratch });
    logger.info('probe', 'i');
    logger.warn('install', 'w', { hint: 'x' });
    logger.error('oauth', 'e');
    await logger.close();

    const lines = (await readLines(logger.getPath())) as Array<{
      level: string;
      phase: string;
      msg: string;
      ts: string;
      schemaVersion: number;
      data?: unknown;
    }>;

    expect(lines).toHaveLength(3);
    expect(lines[0]?.level).toBe('info');
    expect(lines[0]?.phase).toBe('probe');
    expect(lines[0]?.msg).toBe('i');
    expect(lines[1]?.level).toBe('warn');
    expect(lines[1]?.data).toEqual({ hint: 'x' });
    expect(lines[2]?.level).toBe('error');
    // ISO-8601 sanity
    for (const l of lines) {
      expect(typeof l.ts).toBe('string');
      expect(Number.isNaN(Date.parse(l.ts))).toBe(false);
    }
  });

  it('every line carries schemaVersion: 1', async () => {
    const logger = await openLogger({ logsDir: scratch });
    logger.info('probe', 'a');
    logger.warn('probe', 'b');
    logger.error('probe', 'c', { k: 'v' });
    await logger.close();

    const lines = (await readLines(logger.getPath())) as Array<{
      schemaVersion: number;
    }>;
    expect(lines).toHaveLength(3);
    for (const l of lines) {
      expect(l.schemaVersion).toBe(1);
    }
  });

  it('redacts a refresh_token-shaped string before writing to disk', async () => {
    const logger = await openLogger({ logsDir: scratch });
    // Two shapes: the kv hard-list pattern and the bare 1// google-refresh-token shape.
    logger.error('oauth', 'auth failed', {
      payload: '"refresh_token": "1//abc-fake-token"',
      bare: '1//FAKE-REFRESH-TOKEN-VALUE',
    });
    await logger.close();

    const raw = await readFile(logger.getPath(), 'utf8');
    // Neither the kv form nor the bare form should survive. The tail
    // (`fake-token` etc.) is the giveaway — assert it never reaches disk.
    expect(raw).not.toMatch(/abc-fake-token/);
    expect(raw).not.toMatch(/FAKE-REFRESH-TOKEN-VALUE/);
    expect(raw).toContain('[REDACTED]');
  });

  it('redacts email addresses in log payloads (PII pattern)', async () => {
    const logger = await openLogger({ logsDir: scratch });
    logger.info('oauth', 'completed', { user: 'someone@example.com' });
    await logger.close();

    const raw = await readFile(logger.getPath(), 'utf8');
    expect(raw).not.toContain('someone@example.com');
    expect(raw).toContain('[email]');
  });

  it('close() releases the FD so a subsequent rotateLogs can delete the file', async () => {
    const logger = await openLogger({ logsDir: scratch });
    logger.info('probe', 'x');
    const path = logger.getPath();
    await logger.close();

    // Backdate this file deeply so rotation considers it stale, and seed 5
    // newer files so it falls outside the keep-5 window AND has no errors
    // (so sticky-keep doesn't grab it).
    const old = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30);
    await utimes(path, old, old);

    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      const t = new Date(now - i * 1000);
      await seedLog(
        scratch,
        `setup-newer-${i}.log`,
        [{ level: 'info', phase: 'probe', msg: 'ok' }],
        t,
      );
    }

    const result = await rotateLogs(scratch);
    expect(result.deleted).toContain(path);
    // File must actually be gone — proves the FD was released.
    const remaining = await readdir(scratch);
    expect(remaining).not.toContain('setup-2026-04-25T12-34-56.789Z.log');
    // (Whatever name it actually had — assert by absence of the closed file.)
    const closedName = path.split('/').pop() as string;
    expect(remaining).not.toContain(closedName);
  });
});

describe('rotateLogs', () => {
  it('returns kept: [] / deleted: [] when no logs exist', async () => {
    const result = await rotateLogs(scratch);
    expect(result).toEqual({ kept: [], deleted: [] });
  });

  it('returns kept: [] / deleted: [] when the directory does not exist', async () => {
    const missing = join(scratch, 'no-such-dir');
    const result = await rotateLogs(missing);
    expect(result).toEqual({ kept: [], deleted: [] });
  });

  it('keeps the 5 most recent and deletes the rest when no failure logs exist', async () => {
    // Pre-create 7 info-only logs with monotonically descending mtimes.
    const now = Date.now();
    const created: { full: string; rank: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const t = new Date(now - i * 60_000); // 1 minute apart
      const full = await seedLog(
        scratch,
        `setup-r${i}.log`,
        [{ level: 'info', phase: 'probe', msg: 'ok' }],
        t,
      );
      created.push({ full, rank: i });
    }

    const result = await rotateLogs(scratch);
    expect(result.kept).toHaveLength(5);
    expect(result.deleted).toHaveLength(2);

    // The two oldest (rank 5 + 6) must be deleted.
    const deletedSet = new Set(result.deleted);
    expect(deletedSet.has(created[5]!.full)).toBe(true);
    expect(deletedSet.has(created[6]!.full)).toBe(true);

    // The 5 newest (rank 0-4) must be kept.
    const keptSet = new Set(result.kept);
    for (let i = 0; i < 5; i++) {
      expect(keptSet.has(created[i]!.full)).toBe(true);
    }
  });

  it('sticky-keeps the most-recent failure log when it falls outside the top-5 window (6 total kept)', async () => {
    // Setup: 5 newest are info-only, 1 older log carries an error line, 1
    // even-older log also error-but-older should NOT be sticky-kept.
    const now = Date.now();
    const newest: { full: string }[] = [];
    for (let i = 0; i < 5; i++) {
      const t = new Date(now - i * 60_000);
      const full = await seedLog(
        scratch,
        `setup-newest-${i}.log`,
        [{ level: 'info', phase: 'probe', msg: 'ok' }],
        t,
      );
      newest.push({ full });
    }

    // The "first failure" log: most-recent of the failures, but older than
    // all 5 above.
    const failTime = new Date(now - 6 * 60_000);
    const failLog = await seedLog(
      scratch,
      'setup-failure.log',
      [
        { level: 'info', phase: 'probe', msg: 'starting' },
        { level: 'error', phase: 'install', msg: 'brew failed' },
      ],
      failTime,
    );

    // Even-older failure that should NOT survive (older sticky candidate).
    const olderFailTime = new Date(now - 7 * 60_000);
    const olderFail = await seedLog(
      scratch,
      'setup-older-failure.log',
      [{ level: 'error', phase: 'probe', msg: 'old' }],
      olderFailTime,
    );

    const result = await rotateLogs(scratch);
    expect(result.kept).toHaveLength(6);
    expect(result.deleted).toHaveLength(1);
    expect(result.deleted[0]).toBe(olderFail);
    expect(result.kept).toContain(failLog);
    for (const n of newest) {
      expect(result.kept).toContain(n.full);
    }
  });

  it('does not double-count a failure log that already lives in the top-5 (max stays at 5)', async () => {
    const now = Date.now();
    // 5 logs, the 3rd has an error. All within the keep window.
    const created: string[] = [];
    for (let i = 0; i < 5; i++) {
      const t = new Date(now - i * 60_000);
      const lines: object[] =
        i === 2
          ? [{ level: 'error', phase: 'install', msg: 'boom' }]
          : [{ level: 'info', phase: 'probe', msg: 'ok' }];
      created.push(await seedLog(scratch, `setup-t${i}.log`, lines, t));
    }

    const result = await rotateLogs(scratch);
    expect(result.kept).toHaveLength(5);
    expect(result.deleted).toHaveLength(0);
  });

  it('ignores files that do not match setup-*.log', async () => {
    // Both a non-matching name and a matching one — only the matching
    // candidate is rotated; the unrelated file is left alone.
    const now = Date.now();
    await seedLog(
      scratch,
      'setup-only.log',
      [{ level: 'info', phase: 'probe', msg: 'ok' }],
      new Date(now),
    );
    await writeFile(join(scratch, 'unrelated.txt'), 'hi');
    await writeFile(join(scratch, 'README'), 'docs');

    const result = await rotateLogs(scratch);
    expect(result.kept).toHaveLength(1);
    expect(result.deleted).toHaveLength(0);

    const remaining = await readdir(scratch);
    expect(remaining).toContain('unrelated.txt');
    expect(remaining).toContain('README');
  });
});

describe('openLogger + rotation interaction', () => {
  it('rotates BEFORE creating the new log file (the new file is never deleted by its own rotation pass)', async () => {
    // Pre-seed 5 stale logs.
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      const t = new Date(now - (i + 10) * 60_000);
      await seedLog(
        scratch,
        `setup-pre-${i}.log`,
        [{ level: 'info', phase: 'probe', msg: 'ok' }],
        t,
      );
    }

    let logger: SetupLogger | null = null;
    try {
      logger = await openLogger({
        logsDir: scratch,
        timestamp: new Date(now),
      });
      logger.info('probe', 'fresh-run');
    } finally {
      if (logger) await logger.close();
    }

    const remaining = await readdir(scratch);
    // After rotation: 5 newest pre-existing + the new file = 6 setup-*.log.
    // Wait — rotation runs BEFORE open. With 5 pre-existing files, all are
    // within the keep-5 window, so 0 are deleted; then the new file brings
    // the total to 6. (rotateLogs is not re-run after the new file opens.)
    const setupFiles = remaining.filter((f) => f.startsWith('setup-'));
    expect(setupFiles).toHaveLength(6);
    // The brand-new file must be present.
    const newName = (logger as SetupLogger).getPath().split('/').pop() ?? '';
    expect(setupFiles).toContain(newName);
  });
});
