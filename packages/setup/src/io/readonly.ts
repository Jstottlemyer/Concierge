// B6: Read-only I/O boundary for files owned by other tools.
//
// The orchestrator MUST NOT write to any of the following:
//   - ~/.config/gws/client_secret.json   (owned by `gws auth setup`)
//   - ~/.claude.json                     (owned by `claude mcp add/remove`)
//   - ~/Library/Application Support/Claude/...
//                                        (owned by Claude Desktop; only the
//                                         `rm -rf` of the unpacked extension
//                                         dir during the C7 recovery phase
//                                         is permitted, and that lives in
//                                         phases/recover.ts — NOT here)
//
// To make this enforceable at lint time, this module re-exports ONLY the
// read-only subset of `node:fs/promises`. The eslint config has a per-file
// override that flags any import of write/mutate operations from `fs` /
// `node:fs` / `fs/promises` / `node:fs/promises` in this file, so a future
// edit that adds `writeFile` here fails CI with a clear message.
//
// The typed helpers below are the canonical accessors; callers should
// prefer them over the raw re-exports whenever the path is one of the
// three protected ones.

import {
  access as _access,
  readFile as _readFile,
  stat as _stat,
} from 'node:fs/promises';
import { join } from 'node:path';

// Curated re-exports — read-only operations only. DO NOT add write/mutate
// operations here; the eslint rule on this file will catch the import, but
// the convention is also a code-review signal.
export const readFile = _readFile;
export const stat = _stat;
export const access = _access;

/**
 * Read `~/.config/gws/client_secret.json` if it exists.
 *
 * Returns the raw file contents as a UTF-8 string, or `null` if the file is
 * not present. Callers parse + validate; this module's job is the read +
 * not-found probe, nothing more.
 *
 * @param homedir Typically `os.homedir()`. Injectable for tests.
 * @throws on non-ENOENT read failures (permissions, etc.).
 */
export async function readGwsClientSecret(
  homedir: string,
): Promise<string | null> {
  const p = join(homedir, '.config', 'gws', 'client_secret.json');
  return readFileOrNull(p);
}

/**
 * Read `~/.claude.json` if it exists.
 *
 * Returns the raw file contents as a UTF-8 string, or `null` if the file is
 * not present. Callers parse + validate.
 *
 * Note: a richer typed probe of this same file (mcpServers.concierge state
 * machine) lives in `state/claudeJson.ts`. This helper is the byte-level
 * accessor used by `--diagnose` and similar consumers that need the raw
 * contents.
 *
 * @param homedir Typically `os.homedir()`. Injectable for tests.
 * @throws on non-ENOENT read failures (permissions, etc.).
 */
export async function readClaudeJson(
  homedir: string,
): Promise<string | null> {
  const p = join(homedir, '.claude.json');
  return readFileOrNull(p);
}

/**
 * Probe whether the unpacked Claude Desktop extension directory exists for
 * the given namespace.
 *
 * The path is computed as:
 *   <homedir>/Library/Application Support/Claude/Claude Extensions/<namespace>/
 *
 * The literal " " in "Application Support" + "Claude Extensions" is preserved
 * verbatim (`path.join` does NOT escape it). The returned `absPath` is the
 * exact path Claude Desktop unpacks to and the exact path the C7 recovery
 * phase passes to `rm -rf`.
 *
 * This module's responsibility ends at the stat-probe. The actual `rm -rf`
 * is the ONE allowed mutation against this tree, and it lives in
 * `phases/recover.ts` (C7) where the destructive intent is explicit.
 *
 * @param homedir   Typically `os.homedir()`. Injectable for tests.
 * @param namespace The unpacked-extension folder name, e.g.
 *                  `local.mcpb.justin-stottlemyer.concierge-google-workspace`.
 *                  Sourced from the embedded manifest (B2) at runtime.
 */
export async function statClaudeExtensionDir(
  homedir: string,
  namespace: string,
): Promise<{ exists: boolean; absPath: string }> {
  const absPath = join(
    homedir,
    'Library',
    'Application Support',
    'Claude',
    'Claude Extensions',
    namespace,
  );
  try {
    const s = await stat(absPath);
    // Treat anything that exists at this path as "present" — Claude Desktop
    // only ever creates a directory here, but if a stray file appears, the
    // caller's recovery path will surface the inconsistency.
    return { exists: s.isDirectory() || s.isFile(), absPath };
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      return { exists: false, absPath };
    }
    throw err;
  }
}

async function readFileOrNull(absPath: string): Promise<string | null> {
  try {
    return await readFile(absPath, 'utf8');
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string'
  );
}
