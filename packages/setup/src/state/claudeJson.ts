// B1: Read-only probe for ~/.claude.json (Claude Code CLI MCP server registry).
//
// This module is *strictly* read-only. Per Round-2 spike, `claude mcp list --json`
// does not exist — the stable, supported probe pattern is to read the JSON file
// `claude mcp add/remove` itself reads/writes. We never write to it; CLI
// registration is performed by spawning `claude mcp add` elsewhere.
//
// Three semantic states are reported (see `ClaudeJsonState`):
//   - `absent`        — file is missing entirely
//   - `no_concierge`  — file is present + valid JSON, but `mcpServers.concierge` is not set
//   - `registered`    — file is present + valid JSON, with `mcpServers.concierge` set;
//                       `matches` reports whether `args[0]` equals `expectedAbsPath`
//
// JSON parse failures are NOT mapped into a state — they propagate as the
// underlying `SyntaxError` (the caller handles file-corruption recovery).

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ClaudeJsonShape, ClaudeJsonState } from '../types/claudeJson.js';

/**
 * Probe the user's ~/.claude.json for a `concierge` MCP server registration.
 *
 * @param homedir         Typically `os.homedir()`. We accept this as a parameter
 *                        so tests can inject a fake home without monkey-patching `os`.
 * @param expectedAbsPath The absolute path the orchestrator expects to find as
 *                        `args[0]` of the registered server entry (i.e. the
 *                        unpacked `dist/index.js` it just installed).
 * @returns               Discriminated `ClaudeJsonState`.
 * @throws                On JSON parse failure (caller handles).
 *                        On non-ENOENT read failures (permissions, etc.).
 */
export async function probeClaudeRegistration(
  homedir: string,
  expectedAbsPath: string,
): Promise<ClaudeJsonState> {
  const configPath = join(homedir, '.claude.json');

  let raw: string;
  try {
    raw = await readFile(configPath, 'utf8');
  } catch (err: unknown) {
    if (isNodeError(err) && err.code === 'ENOENT') {
      return { kind: 'absent' };
    }
    throw err;
  }

  // Parse failures intentionally propagate. The caller decides how to recover
  // (e.g. backup-and-replace, or surface to user).
  const parsed = JSON.parse(raw) as ClaudeJsonShape;

  const servers = parsed.mcpServers;
  if (servers === undefined || typeof servers !== 'object' || servers === null) {
    return { kind: 'no_concierge', otherServers: [] };
  }

  const conciergeEntry = servers['concierge'];
  if (conciergeEntry === undefined) {
    const otherServers = Object.keys(servers).filter((k) => k !== 'concierge');
    return { kind: 'no_concierge', otherServers };
  }

  // Defensive: missing/empty command or args[] should NOT crash. Report as
  // registered-but-mismatched so the orchestrator's recovery path takes over.
  const args = Array.isArray(conciergeEntry.args) ? conciergeEntry.args : [];
  const actualAbsPath = typeof args[0] === 'string' ? args[0] : '';

  return {
    kind: 'registered',
    expectedAbsPath,
    actualAbsPath,
    matches: actualAbsPath === expectedAbsPath,
  };
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as { code: unknown }).code === 'string'
  );
}
