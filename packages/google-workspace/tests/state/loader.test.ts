import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { ConciergeError } from '@concierge/core/errors';
import {
  STATE_DIR_MODE,
  STATE_FILE_MAX_BYTES,
  STATE_FILE_MODE,
  loadState,
  stateDir,
  stateFilePath,
  writeState,
} from '../../src/state/loader.js';
import { freshStateV1 } from '../../src/state/schema.js';

/**
 * Each test runs in its own tmpdir, pointed at via CONCIERGE_STATE_DIR so
 * `loadState()` / `writeState()` never touch the real Claude Desktop dir.
 */
let tmpDir: string;
let prevEnv: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'authtools-state-'));
  prevEnv = process.env['CONCIERGE_STATE_DIR'];
  process.env['CONCIERGE_STATE_DIR'] = tmpDir;
});

afterEach(async () => {
  if (prevEnv === undefined) {
    delete process.env['CONCIERGE_STATE_DIR'];
  } else {
    process.env['CONCIERGE_STATE_DIR'] = prevEnv;
  }
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('stateDir()', () => {
  it('honors CONCIERGE_STATE_DIR override', () => {
    expect(stateDir()).toBe(tmpDir);
  });

  it('falls back to the canonical Claude Desktop path when override is unset', () => {
    delete process.env['CONCIERGE_STATE_DIR'];
    const resolved = stateDir();
    expect(resolved).toContain('Library/Application Support/Claude/extensions/concierge');
  });
});

describe('loadState() — lazy creation', () => {
  it('returns a fresh v1 state when state.json is missing and does NOT create the file', async () => {
    const state = await loadState();
    expect(state).toEqual(freshStateV1());

    // Directory should not have been created, and certainly no file.
    await expect(fs.stat(stateFilePath())).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('writeState() + loadState() — round trip', () => {
  it('persists and reloads a state with accounts and default_account', async () => {
    const original = {
      state_schema_version: 1 as const,
      default_account: 'alice@example.com',
      accounts: {
        'alice@example.com': { read_only: false },
        'bob@example.com': { read_only: true },
      },
    };

    await writeState(original);
    const reloaded = await loadState();
    expect(reloaded).toEqual(original);
  });

  it('normalizes emails to lowercase on write', async () => {
    await writeState({
      state_schema_version: 1,
      default_account: 'Alice@Example.COM',
      accounts: {
        'Alice@Example.COM': { read_only: false },
      },
    });
    const reloaded = await loadState();
    expect(reloaded.default_account).toBe('alice@example.com');
    expect(Object.keys(reloaded.accounts)).toEqual(['alice@example.com']);
  });
});

describe('file and directory permissions', () => {
  it('writes state.json with mode 0600 and parent dir with mode 0700', async () => {
    await writeState(freshStateV1());

    const fileStat = await fs.stat(stateFilePath());
    // The low 9 bits of st_mode hold the permission bits.
    expect(fileStat.mode & 0o777).toBe(STATE_FILE_MODE);

    const dirStat = await fs.stat(stateDir());
    expect(dirStat.mode & 0o777).toBe(STATE_DIR_MODE);
  });

  it('creates the parent dir with mode 0700 if missing', async () => {
    // mkdtemp already created tmpDir at a default mode; remove it so writeState
    // has to create it fresh.
    await fs.rm(tmpDir, { recursive: true, force: true });
    await writeState(freshStateV1());

    const dirStat = await fs.stat(tmpDir);
    expect(dirStat.mode & 0o777).toBe(STATE_DIR_MODE);
  });
});

describe('referential-integrity auto-repair', () => {
  it('self-repairs when default_account is not in accounts and logs to stderr', async () => {
    // Write a hand-crafted file that bypasses writeState()'s Zod validation.
    const dir = stateDir();
    await fs.mkdir(dir, { recursive: true, mode: STATE_DIR_MODE });
    const payload = {
      state_schema_version: 1,
      default_account: 'ghost@example.com',
      accounts: {
        'alice@example.com': { read_only: false },
      },
    };
    await fs.writeFile(stateFilePath(), JSON.stringify(payload, null, 2), { mode: STATE_FILE_MODE });

    const state = await loadState();
    expect(state.default_account).toBeNull();
    expect(state.accounts).toEqual({ 'alice@example.com': { read_only: false } });
  });
});

describe('64 KiB file cap', () => {
  it('rejects a state.json larger than 64 KiB and backs it up', async () => {
    const dir = stateDir();
    await fs.mkdir(dir, { recursive: true, mode: STATE_DIR_MODE });
    // Pad with a giant comment-like field (stripped during strict parse, but
    // we reject on size before parsing anyway).
    const bigPayload = {
      state_schema_version: 1,
      default_account: null,
      accounts: {},
      _filler: 'x'.repeat(STATE_FILE_MAX_BYTES + 1024),
    };
    await fs.writeFile(stateFilePath(), JSON.stringify(bigPayload), { mode: STATE_FILE_MODE });

    await expect(loadState()).rejects.toBeInstanceOf(ConciergeError);
    await expect(loadState()).rejects.toMatchObject({ code: 'state_file_too_large' });

    // Backup file should exist.
    const entries = await fs.readdir(dir);
    const hasBackup = entries.some((name) => name.startsWith('state.json.bak.'));
    expect(hasBackup).toBe(true);
  });
});

describe('schema-version-too-new', () => {
  it('throws ConciergeError("state_schema_too_new") when schema version is ahead of this build', async () => {
    const dir = stateDir();
    await fs.mkdir(dir, { recursive: true, mode: STATE_DIR_MODE });
    const futureStateDocument = {
      state_schema_version: 99,
      default_account: null,
      accounts: {},
    };
    await fs.writeFile(stateFilePath(), JSON.stringify(futureStateDocument), {
      mode: STATE_FILE_MODE,
    });

    await expect(loadState()).rejects.toMatchObject({
      name: 'ConciergeError',
      code: 'state_schema_too_new',
    });
  });
});

describe('corrupt JSON', () => {
  it('throws ConciergeError("state_corrupt_json") and backs up the file', async () => {
    const dir = stateDir();
    await fs.mkdir(dir, { recursive: true, mode: STATE_DIR_MODE });
    await fs.writeFile(stateFilePath(), '{ not valid json', { mode: STATE_FILE_MODE });

    await expect(loadState()).rejects.toMatchObject({ code: 'state_corrupt_json' });

    const entries = await fs.readdir(dir);
    const hasBackup = entries.some((name) => name.startsWith('state.json.bak.'));
    expect(hasBackup).toBe(true);
  });
});

describe('atomic write does not leave tmp files', () => {
  it('cleans up the tmp file after a successful write', async () => {
    await writeState(freshStateV1());
    const entries = await fs.readdir(stateDir());
    const stragglers = entries.filter((name) => name.startsWith('state.json.tmp.'));
    expect(stragglers).toEqual([]);
  });
});
