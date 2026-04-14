// Binary + config-path resolver for the bundled `gws` CLI.
//
// Decision #11 (binary integrity): production always loads the checksummed
// binary shipped inside the .mcpb bundle. For v1 scaffolding the binary does
// not yet live on disk; the resolver documents the expected layout and lets
// dev/test workflows override the path via env var (CONCIERGE_GWS_BIN) or, as
// a last-resort fallback, via `which gws` on PATH.
//
// Decision #6 (subprocess safety): callers pass the resolved path directly to
// `spawn(..., { shell: false })`. Never interpolate this string into a shell
// command. Never hand the path to `exec`.
//
// The resolver is pure — no side effects beyond `fs.accessSync` stat checks.
// Callers are expected to memoize if they care about performance; the cost is
// a handful of syscalls.

import { accessSync, constants as fsConstants } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

import { ConciergeError } from '@concierge/core/errors';

/** Env var clients can set to point at a specific `gws` binary (dev/test). */
export const GWS_BIN_ENV = 'CONCIERGE_GWS_BIN';

/** Env var gws itself consults for its config dir. We observe but never set it. */
export const GWS_CONFIG_DIR_ENV = 'GOOGLE_WORKSPACE_CLI_CONFIG_DIR';

/**
 * Resolve the absolute path to the `gws` binary.
 *
 * Precedence:
 *   1. `CONCIERGE_GWS_BIN` env var (if the file exists and is executable).
 *   2. `<pkg-root>/bin/gws` — the bundled binary path used once v1 ships
 *      inside the `.mcpb` archive.
 *   3. `which gws` fallback — development + CI convenience only. Not used in
 *      production since the `.mcpb` bundle always ships its own binary.
 *
 * Throws `ConciergeError('gws_error')` if no candidate resolves. The runner
 * catches that and surfaces it as a normal gws-invocation failure.
 */
export function resolveGwsBinary(): string {
  // 1) Explicit override — tests + local dev.
  const override = process.env[GWS_BIN_ENV];
  if (override !== undefined && override.length > 0) {
    if (isExecutable(override)) {
      return path.resolve(override);
    }
    throw new ConciergeError(
      'gws_error',
      `CONCIERGE_GWS_BIN points at '${override}' but the file is missing or not executable`,
    );
  }

  // 2) Bundled binary under the package root. Try both candidate layouts:
  //    - prod (.mcpb): tsup bundles to `dist/index.js` → pkg root is ONE level up
  //    - dev (vitest / src): source file at `src/gws/paths.ts` → pkg root is TWO levels up
  //    First existing candidate wins.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const bundledCandidates = [
    path.join(here, '..', 'bin', 'gws'),       // dist/index.js → ../bin/gws
    path.join(here, '..', '..', 'bin', 'gws'), // src/gws/paths.ts → ../../bin/gws
  ];
  for (const candidate of bundledCandidates) {
    if (isExecutable(candidate)) {
      return path.resolve(candidate);
    }
  }

  // 3) PATH fallback — dev + CI only.
  const onPath = whichGws();
  if (onPath !== null) {
    return onPath;
  }

  throw new ConciergeError(
    'gws_error',
    `Cannot locate the gws binary. Set ${GWS_BIN_ENV} or bundle a binary at bin/gws.`,
  );
}

/** True if the path exists and is executable by the current process. */
function isExecutable(candidate: string): boolean {
  try {
    accessSync(candidate, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fallback: `which gws` on the ambient PATH. Returns the absolute path or
 * `null`. Uses `execSync` with an argv-free command (tolerable — input is
 * literal, not user-supplied).
 */
function whichGws(): string | null {
  try {
    const out = execSync('command -v gws', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const trimmed = out.trim();
    if (trimmed.length === 0) return null;
    if (!isExecutable(trimmed)) return null;
    return path.resolve(trimmed);
  } catch {
    return null;
  }
}

/**
 * Return the gws config directory. Respects `GOOGLE_WORKSPACE_CLI_CONFIG_DIR`
 * if set, otherwise defaults to `~/.config/gws/`.
 *
 * We do NOT export this env var into child processes — gws reads its own env.
 * This helper exists so tests and diagnostics can inspect the active path.
 */
export function resolveConfigDir(): string {
  const override = process.env[GWS_CONFIG_DIR_ENV];
  if (override !== undefined && override.length > 0) {
    return path.resolve(override);
  }
  return path.join(os.homedir(), '.config', 'gws');
}
