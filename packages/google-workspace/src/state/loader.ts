// state.json loader + atomic writer.
//
// Path resolution (plan.md Decision #7):
//   - `process.env.CONCIERGE_STATE_DIR` if set (test override).
//   - Otherwise `~/Library/Application Support/Claude/extensions/authtools/`.
//
// Contracts:
//   - `loadState()` returns a fresh v1 state if the file does not exist. The
//     file is NOT created on load; first write happens via `writeState()`.
//   - Referential-integrity violation → self-repair (set `default_account`
//     to null), log to stderr, return the repaired state. The repair is NOT
//     persisted automatically; the next `writeState()` will fix the file.
//   - Schema version newer than this build → ConciergeError("state_schema_too_new").
//   - Corrupt JSON or migration failure → back up offending file to
//     `state.json.bak.<ISO timestamp>` before surfacing the error. Returns a
//     fresh state so the caller may decide to continue (loader logs and
//     re-raises; callers handle the error).
//   - File size > 64 KiB → ConciergeError("state_file_too_large") before
//     parsing. Offending file is backed up.
//
// Writes are atomic: write to `state.json.tmp.<pid>.<rand>` in the same
// directory, fdatasync, rename(2). Mode 0600 on file, 0700 on parent dir
// (dir created if missing with correct mode).

import { randomBytes } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { ConciergeError } from '@concierge/core/errors';
import {
  CURRENT_STATE_SCHEMA_VERSION,
  freshStateV1,
  StateV1Schema,
  type StateV1,
} from './schema.js';
import { migrateToCurrent, probeSchemaVersion } from './migrator.js';

/** File name of the persisted state document. */
export const STATE_FILE_NAME = 'state.json';

/** 64 KiB hard cap on the size of state.json before we refuse to parse. */
export const STATE_FILE_MAX_BYTES = 64 * 1024;

/** Mode for state.json itself (owner RW only). */
export const STATE_FILE_MODE = 0o600;

/** Mode for the parent directory (owner RWX only). */
export const STATE_DIR_MODE = 0o700;

/**
 * Resolve the directory that holds state.json. Honors the
 * `CONCIERGE_STATE_DIR` env override used by tests; otherwise returns the
 * canonical Claude Desktop extension data path under `$HOME`.
 */
export function stateDir(): string {
  const override = process.env['CONCIERGE_STATE_DIR'];
  if (override !== undefined && override.length > 0) {
    return override;
  }
  return path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'Claude',
    'extensions',
    'concierge',
  );
}

/** Absolute path to the state.json file inside the resolved state dir. */
export function stateFilePath(): string {
  return path.join(stateDir(), STATE_FILE_NAME);
}

/** Normalize an email key to its canonical (lowercase) form. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Apply `normalizeEmail` to every key in an `accounts` map and to the
 * `default_account` field. Collisions (two keys collapsing to the same
 * lowercased value) are resolved last-write-wins.
 */
function normalizeState(state: StateV1): StateV1 {
  const accounts: Record<string, { read_only: boolean }> = {};
  for (const [key, value] of Object.entries(state.accounts)) {
    accounts[normalizeEmail(key)] = { read_only: value.read_only };
  }
  const def = state.default_account === null ? null : normalizeEmail(state.default_account);
  return {
    state_schema_version: state.state_schema_version,
    default_account: def,
    accounts,
  };
}

/**
 * Copy the offending file to `state.json.bak.<ISO timestamp>` in the same
 * directory. Best-effort: logs (stderr) and swallows errors so we never mask
 * the original failure.
 */
async function backupCorruptFile(filePath: string, reason: string): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:]/g, '-');
  const backupPath = `${filePath}.bak.${stamp}`;
  try {
    await fs.copyFile(filePath, backupPath);
    process.stderr.write(
      `concierge: backed up ${filePath} → ${backupPath} (reason: ${reason})\n`,
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `concierge: failed to back up ${filePath} (reason: ${reason}): ${message}\n`,
    );
  }
}

/**
 * Ensure the state directory exists and has mode 0700. Safe to call
 * repeatedly; no-op if already present with correct perms.
 */
async function ensureStateDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: STATE_DIR_MODE });
  // mkdir respects umask, which can widen the mode beyond 0700 on some
  // systems. Force it explicitly.
  await fs.chmod(dir, STATE_DIR_MODE);
}

/**
 * Read raw bytes from state.json, enforcing the 64 KiB cap before we even
 * try to parse. Returns `null` if the file does not exist.
 */
async function readStateBytes(filePath: string): Promise<Buffer | null> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(filePath, fsConstants.O_RDONLY);
    const stat = await handle.stat();
    if (stat.size > STATE_FILE_MAX_BYTES) {
      await handle.close();
      handle = undefined;
      await backupCorruptFile(filePath, 'file_too_large');
      throw new ConciergeError(
        'state_file_too_large',
        `state.json is ${String(stat.size)} bytes (max ${String(STATE_FILE_MAX_BYTES)})`,
      );
    }
    const buf = await handle.readFile();
    return buf;
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      return null;
    }
    throw err;
  } finally {
    if (handle !== undefined) {
      await handle.close();
    }
  }
}

/** Narrow unknown to NodeJS.ErrnoException without reaching for `any`. */
function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

/**
 * Load + validate state.json. Lazy-creation semantics: missing file returns
 * a fresh v1 state without touching disk. See module header for the full
 * error matrix.
 */
export async function loadState(): Promise<StateV1> {
  const dir = stateDir();
  const filePath = path.join(dir, STATE_FILE_NAME);

  const bytes = await readStateBytes(filePath);
  if (bytes === null) {
    return freshStateV1();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await backupCorruptFile(filePath, 'json_parse_error');
    throw new ConciergeError('state_corrupt_json', `state.json is not valid JSON: ${message}`);
  }

  const version = probeSchemaVersion(parsed);
  if (version === null) {
    await backupCorruptFile(filePath, 'missing_schema_version');
    throw new ConciergeError(
      'state_corrupt_schema',
      'state.json is missing a valid state_schema_version field',
    );
  }

  let migrated: unknown;
  try {
    migrated = migrateToCurrent(parsed, version);
  } catch (err: unknown) {
    if (err instanceof ConciergeError && err.code === 'state_schema_too_new') {
      // Do not back up on "too new" — the file is not corrupt, just from a
      // newer Concierge build. Re-raise for Decision #13 out-of-band recovery.
      throw err;
    }
    await backupCorruptFile(filePath, 'migration_failure');
    throw err;
  }

  const result = StateV1Schema.safeParse(migrated);
  if (!result.success) {
    // If the only issue is the referential-integrity invariant we added via
    // superRefine, self-repair (clear default_account) and log. Any other
    // issue is real corruption and gets backed up + surfaced.
    const onlyRefIntegrity = result.error.issues.every(
      (issue) =>
        issue.code === 'custom' &&
        typeof issue.params === 'object' &&
        issue.params !== null &&
        (issue.params as Record<string, unknown>)['concierge'] === 'referential_integrity',
    );

    if (onlyRefIntegrity) {
      // Safe cast: Zod parsed the object shape but failed only our custom
      // invariant, so the object matches StateV1's static type — we just
      // need to clear default_account.
      const repaired: StateV1 = {
        state_schema_version: CURRENT_STATE_SCHEMA_VERSION,
        default_account: null,
        accounts: (migrated as { accounts: Record<string, { read_only: boolean }> }).accounts,
      };
      process.stderr.write(
        'concierge: state.json referential-integrity violation (default_account not in accounts); self-repairing to default_account=null\n',
      );
      return normalizeState(repaired);
    }

    await backupCorruptFile(filePath, 'schema_validation_failure');
    throw new ConciergeError(
      'state_corrupt_schema',
      `state.json failed schema validation: ${result.error.message}`,
    );
  }

  return normalizeState(result.data);
}

/**
 * Persist `state` to state.json atomically. Validates against the schema
 * before writing (never write an invalid document). Creates the parent
 * directory if missing with mode 0700. File mode is 0600.
 */
export async function writeState(state: StateV1): Promise<void> {
  const dir = stateDir();
  const filePath = path.join(dir, STATE_FILE_NAME);

  const normalized = normalizeState(state);
  const validated = StateV1Schema.parse(normalized);

  await ensureStateDir(dir);

  const payload = Buffer.from(`${JSON.stringify(validated, null, 2)}\n`, 'utf8');
  const suffix = randomBytes(6).toString('hex');
  const tmpPath = path.join(dir, `${STATE_FILE_NAME}.tmp.${String(process.pid)}.${suffix}`);

  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(tmpPath, fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_TRUNC, STATE_FILE_MODE);
    await handle.writeFile(payload);
    await handle.datasync();
    await handle.close();
    handle = undefined;
    // Force mode in case umask narrowed/widened it.
    await fs.chmod(tmpPath, STATE_FILE_MODE);
    await fs.rename(tmpPath, filePath);
  } catch (err: unknown) {
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch {
        // best-effort cleanup
      }
    }
    try {
      await fs.unlink(tmpPath);
    } catch {
      // tmp file may already be gone; ignore
    }
    throw err;
  }
}
