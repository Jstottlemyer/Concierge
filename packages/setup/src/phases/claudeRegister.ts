// C5: Claude registration phase — register the bundled Concierge `.mcpb` with
// both Claude install targets (Desktop + CLI). Idempotent; never destructive
// on the happy path; degrades to per-target `skipped-target-missing` when a
// target isn't installed at all.
//
// Two targets, two protocols:
//
//   1. Claude Desktop. Install protocol is "open the .mcpb file with Claude.app".
//      Pre-emptive recovery for N15 (stale install): if the unpacked extension
//      directory already exists AND its `dist/index.js` sha256 doesn't match
//      what the embedded manifest says we're installing, we run a subset of
//      the hard-reinstall sequence (quit + rm) BEFORE the open. This keeps
//      Claude Desktop from silently keeping the old unpacked copy when the
//      .mcpb is "reopened" with a newer version.
//
//   2. Claude Code CLI. Install protocol is `claude mcp add --transport stdio
//      concierge --scope user -- node <unpacked>/dist/index.js`. There is no
//      built-in idempotency, so we probe `~/.claude.json` first via B1's
//      `probeClaudeRegistration`. Three cases: `absent` (CLI not installed or
//      never configured), `no_concierge` (CLI installed, no Concierge entry),
//      `registered` (entry present — `matches` tells us if `args[0]` is the
//      path we expected). On a path mismatch we `claude mcp remove concierge`
//      then `claude mcp add ...` to re-register at the correct path.
//
// Namespace (`local.mcpb.<author>.<name>`) is read from the embedded manifest
// at runtime — never hardcoded. The orchestrator owns the unpacked extraction
// dir (mktemp -d per D14), and the `unpackedDistIndexJsPath` argument is the
// same path CLI registration writes into `~/.claude.json`. The Desktop
// stale-check uses a DIFFERENT path: `${homedir}/Library/Application Support/
// Claude/Claude Extensions/<namespace>/dist/index.js`, which is what Claude
// Desktop unpacked from the previous .mcpb install (if any).
//
// `hardReinstallSequence` is exported for C7 (recovery) reuse — see plan
// task C5/C7 reuse contract. It runs the full 5-step sequence: quit Claude
// (osascript) → rm unpacked dir → open Claude → open .mcpb → CLI re-register.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { probeClaudeRegistration } from '../state/claudeJson.js';
import { statClaudeExtensionDir } from '../io/readonly.js';
import type { EmbeddedManifest } from '../types/manifest.js';

export type ClaudeTarget = 'desktop' | 'cli';

export interface RegisterOptions {
  /** Embedded manifest — provides namespace + bundled .mcpb sha256. */
  manifest: EmbeddedManifest;
  /** Path to the .mcpb file (typically packages/setup/assets/<filename>). */
  mcpbPath: string;
  /** Path to the orchestrator-owned unpacked `dist/index.js` (mktemp -d). */
  unpackedDistIndexJsPath: string;
  /** User homedir (typically `os.homedir()`). */
  homedir: string;
}

export interface RegisterTargetResult {
  target: ClaudeTarget;
  status:
    | 'registered'
    | 'skipped-target-missing'
    | 'skipped-already-registered'
    | 'failed';
  detail?: string;
}

export interface RegisterResult {
  desktop: RegisterTargetResult;
  cli: RegisterTargetResult;
}

/** Resolve the `claude` binary. Honour PATH (so tests can shim it via
 *  `tests/fixtures/bin` on PATH), with an explicit `CONCIERGE_TEST_CLAUDE_BIN`
 *  override for tests that prefer absolute pathing. */
function resolveClaudeBin(): string {
  return process.env['CONCIERGE_TEST_CLAUDE_BIN'] ?? 'claude';
}

/** Resolve the `osascript` binary. Tests can shim via `CONCIERGE_TEST_OSASCRIPT_BIN`
 *  (or by putting a shim earlier on PATH). Defaults to PATH lookup. */
function resolveOsascriptBin(): string {
  return process.env['CONCIERGE_TEST_OSASCRIPT_BIN'] ?? 'osascript';
}

/** Resolve the `open` binary. Tests can shim via `CONCIERGE_TEST_OPEN_BIN`,
 *  or put a shim earlier on PATH. Defaults to PATH lookup. */
function resolveOpenBin(): string {
  return process.env['CONCIERGE_TEST_OPEN_BIN'] ?? 'open';
}

/** Resolve the locations we'll probe for Claude.app. Tests can override via
 *  `CONCIERGE_TEST_CLAUDE_APP_PATHS` (colon-separated). When unset, we look
 *  in the two standard macOS install dirs. */
function resolveClaudeAppPaths(homedir: string): readonly string[] {
  const override = process.env['CONCIERGE_TEST_CLAUDE_APP_PATHS'];
  if (override !== undefined && override.length > 0) {
    return override.split(':').filter((p) => p.length > 0);
  }
  return ['/Applications/Claude.app', join(homedir, 'Applications', 'Claude.app')];
}

interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Thin promise wrapper around execFile that NEVER rejects — caller inspects
 *  exit code + stderr. Mirrors the style used by the rest of the phases/. */
async function run(
  bin: string,
  args: readonly string[],
): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(bin, args, { encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err !== null) {
        const code =
          typeof (err as NodeJS.ErrnoException & { code?: unknown }).code ===
          'number'
            ? ((err as unknown) as { code: number }).code
            : -1;
        resolve({ exitCode: code, stdout, stderr });
        return;
      }
      resolve({ exitCode: 0, stdout, stderr });
    });
  });
}

/** SHA-256 of a file as lowercase hex; null if the file isn't readable. */
async function sha256OfFile(absPath: string): Promise<string | null> {
  try {
    const buf = await readFile(absPath);
    return createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

/** Probe whether Claude.app is installed in either standard location. */
async function isClaudeDesktopInstalled(homedir: string): Promise<boolean> {
  const candidates = resolveClaudeAppPaths(homedir);
  for (const candidate of candidates) {
    try {
      const { stat } = await import('node:fs/promises');
      const s = await stat(candidate);
      if (s.isDirectory() || s.isFile()) return true;
    } catch {
      // ENOENT or permission — try next candidate
    }
  }
  return false;
}

/** Probe whether the `claude` CLI is on PATH (or via the test override). */
async function isClaudeCliInstalled(): Promise<boolean> {
  const bin = resolveClaudeBin();
  // `claude --version` is the cheapest probe and matches the behavior the
  // F2a shim implements. If it exits 0, CLI is reachable.
  const res = await run(bin, ['--version']);
  return res.exitCode === 0;
}

// ---------------------------------------------------------------------------
// Desktop primitives
// ---------------------------------------------------------------------------

/** osascript quit Claude. No-op if Claude isn't running; we always swallow
 *  the exit code (osascript may return non-zero when the app isn't open).
 *  Errors here are never propagated — the recovery path doesn't depend on
 *  Claude having been running. */
async function quitClaudeApp(): Promise<void> {
  const bin = resolveOsascriptBin();
  await run(bin, ['-e', 'quit app "Claude"']);
}

/** rm -rf the unpacked-extension dir for a given namespace. Idempotent. */
async function removeUnpackedExtension(
  homedir: string,
  namespace: string,
): Promise<void> {
  const target = join(
    homedir,
    'Library',
    'Application Support',
    'Claude',
    'Claude Extensions',
    namespace,
  );
  await rm(target, { recursive: true, force: true });
}

/** `open -a Claude` (relaunch). Best-effort; result is informational. */
async function openClaudeApp(): Promise<ExecResult> {
  return run(resolveOpenBin(), ['-a', 'Claude']);
}

/** `open -a Claude <mcpbPath>` (install / reinstall). */
async function openMcpbInClaude(mcpbPath: string): Promise<ExecResult> {
  return run(resolveOpenBin(), ['-a', 'Claude', mcpbPath]);
}

// ---------------------------------------------------------------------------
// CLI primitives
// ---------------------------------------------------------------------------

async function claudeMcpRemove(): Promise<ExecResult> {
  return run(resolveClaudeBin(), ['mcp', 'remove', 'concierge']);
}

async function claudeMcpAdd(unpackedDistIndexJsPath: string): Promise<ExecResult> {
  return run(resolveClaudeBin(), [
    'mcp',
    'add',
    '--transport',
    'stdio',
    'concierge',
    '--scope',
    'user',
    '--',
    'node',
    unpackedDistIndexJsPath,
  ]);
}

// ---------------------------------------------------------------------------
// Per-target registration
// ---------------------------------------------------------------------------

async function registerDesktop(options: RegisterOptions): Promise<RegisterTargetResult> {
  const installed = await isClaudeDesktopInstalled(options.homedir);
  if (!installed) {
    return {
      target: 'desktop',
      status: 'skipped-target-missing',
      detail: 'Claude.app not present in /Applications or ~/Applications.',
    };
  }

  const namespace = options.manifest.bundledMcpb.namespace;
  const expectedSha = options.manifest.bundledMcpb.sha256.toLowerCase();
  const probe = await statClaudeExtensionDir(options.homedir, namespace);

  if (probe.exists) {
    const installedDistIndexJs = join(probe.absPath, 'dist', 'index.js');
    const actualSha = await sha256OfFile(installedDistIndexJs);
    if (actualSha !== null && actualSha.toLowerCase() === expectedSha) {
      // Already installed at the expected version — nothing to do for Desktop.
      // (CLI is independent and probed/registered separately.)
      return {
        target: 'desktop',
        status: 'skipped-already-registered',
        detail: `Unpacked extension matches manifest sha256 (${expectedSha.slice(0, 12)}…).`,
      };
    }
    // Stale install on first run (N15) — quit Claude + rm before the install.
    // We do NOT relaunch here; `open -a Claude <.mcpb>` will launch Claude as
    // part of installing the extension.
    try {
      await quitClaudeApp();
      await removeUnpackedExtension(options.homedir, namespace);
    } catch (err) {
      return {
        target: 'desktop',
        status: 'failed',
        detail: `Pre-emptive stale-install cleanup failed: ${(err as Error).message}`,
      };
    }
  }

  const openRes = await openMcpbInClaude(options.mcpbPath);
  if (openRes.exitCode !== 0) {
    return {
      target: 'desktop',
      status: 'failed',
      detail: `open -a Claude <.mcpb> exited ${String(openRes.exitCode)}: ${openRes.stderr.trim()}`,
    };
  }
  return {
    target: 'desktop',
    status: 'registered',
    detail: probe.exists
      ? 'Pre-emptive rm-then-open completed (stale install replaced).'
      : 'Clean install via open -a Claude.',
  };
}

async function registerCli(options: RegisterOptions): Promise<RegisterTargetResult> {
  // Probe the JSON registry first — single source of truth for "is concierge
  // already registered, and at the right path".
  let state: Awaited<ReturnType<typeof probeClaudeRegistration>>;
  try {
    state = await probeClaudeRegistration(
      options.homedir,
      options.unpackedDistIndexJsPath,
    );
  } catch (err) {
    // JSON parse failure or non-ENOENT IO error. Surface as `failed`; the
    // orchestrator's recovery path knows how to proceed.
    return {
      target: 'cli',
      status: 'failed',
      detail: `Probe of ~/.claude.json failed: ${(err as Error).message}`,
    };
  }

  // If the registry file is absent AND the `claude` CLI itself isn't on PATH,
  // the user simply doesn't have Claude Code CLI installed — skip cleanly.
  if (state.kind === 'absent') {
    const cliPresent = await isClaudeCliInstalled();
    if (!cliPresent) {
      return {
        target: 'cli',
        status: 'skipped-target-missing',
        detail: 'No ~/.claude.json and `claude` not on PATH — CLI not installed.',
      };
    }
    // CLI present but no config yet — proceed to add.
    const addRes = await claudeMcpAdd(options.unpackedDistIndexJsPath);
    if (addRes.exitCode !== 0) {
      return {
        target: 'cli',
        status: 'failed',
        detail: `claude mcp add exited ${String(addRes.exitCode)}: ${addRes.stderr.trim()}`,
      };
    }
    return { target: 'cli', status: 'registered', detail: 'Initial registration.' };
  }

  if (state.kind === 'registered' && state.matches) {
    return {
      target: 'cli',
      status: 'skipped-already-registered',
      detail: `Already registered at expected path (${state.actualAbsPath}).`,
    };
  }

  // Either `no_concierge` or `registered` with mismatched path. If a stale
  // entry exists, remove it first so `mcp add` doesn't refuse with "already
  // registered" (the F2a shim semantics).
  if (state.kind === 'registered') {
    const removeRes = await claudeMcpRemove();
    if (removeRes.exitCode !== 0) {
      return {
        target: 'cli',
        status: 'failed',
        detail: `claude mcp remove exited ${String(removeRes.exitCode)}: ${removeRes.stderr.trim()}`,
      };
    }
  }
  const addRes = await claudeMcpAdd(options.unpackedDistIndexJsPath);
  if (addRes.exitCode !== 0) {
    return {
      target: 'cli',
      status: 'failed',
      detail: `claude mcp add exited ${String(addRes.exitCode)}: ${addRes.stderr.trim()}`,
    };
  }
  return {
    target: 'cli',
    status: 'registered',
    detail:
      state.kind === 'registered'
        ? `Re-registered (was at ${state.actualAbsPath}).`
        : 'Registered (no prior concierge entry).',
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Register Concierge with all detected Claude targets. Each target's outcome
 *  is independent — Desktop being absent does not skip CLI, and vice versa. */
export async function registerClaude(options: RegisterOptions): Promise<RegisterResult> {
  // Run the two targets sequentially. They write to entirely disjoint state
  // (Claude Desktop's `Application Support` tree vs. `~/.claude.json`), but
  // running them sequentially keeps test output deterministic and avoids any
  // accidental shared-resource contention if a future change adds one.
  const desktop = await registerDesktop(options);
  const cli = await registerCli(options);
  return { desktop, cli };
}

/** Hard-reinstall sequence — exported for C7 (recovery) reuse.
 *
 *  Steps:
 *    1. osascript quit Claude  (no-op if Claude isn't running)
 *    2. rm -rf <unpacked extension dir>
 *    3. open -a Claude         (relaunch the host)
 *    4. open -a Claude <.mcpb> (install the bundled .mcpb)
 *    5. CLI: remove concierge entry if present, then `claude mcp add ...`
 *
 *  Returns a `RegisterResult` with a `desktop` outcome reflecting the open
 *  call's success, and a `cli` outcome reflecting the (re-)registration.
 *  This is the ONE place that calls steps 1-4 unconditionally — `registerClaude`'s
 *  Desktop path only runs the quit+rm subset on detected staleness. */
export async function hardReinstallSequence(
  options: RegisterOptions,
): Promise<RegisterResult> {
  const desktopInstalled = await isClaudeDesktopInstalled(options.homedir);

  let desktop: RegisterTargetResult;
  if (!desktopInstalled) {
    desktop = {
      target: 'desktop',
      status: 'skipped-target-missing',
      detail: 'Claude.app not present — skipping hard-reinstall for Desktop.',
    };
  } else {
    try {
      await quitClaudeApp(); // step 1
      await removeUnpackedExtension(
        options.homedir,
        options.manifest.bundledMcpb.namespace,
      ); // step 2
      await openClaudeApp(); // step 3
      const openRes = await openMcpbInClaude(options.mcpbPath); // step 4
      if (openRes.exitCode !== 0) {
        desktop = {
          target: 'desktop',
          status: 'failed',
          detail: `Hard-reinstall: open -a Claude <.mcpb> exited ${String(
            openRes.exitCode,
          )}: ${openRes.stderr.trim()}`,
        };
      } else {
        desktop = {
          target: 'desktop',
          status: 'registered',
          detail: 'Hard-reinstall (quit + rm + open Claude + open .mcpb) completed.',
        };
      }
    } catch (err) {
      desktop = {
        target: 'desktop',
        status: 'failed',
        detail: `Hard-reinstall failed: ${(err as Error).message}`,
      };
    }
  }

  // Step 5: CLI re-register. Always remove-if-present then add, regardless of
  // current `~/.claude.json` state — the recovery path is the explicit
  // "rebuild from scratch" mode.
  const cli = await hardReinstallCli(options);

  return { desktop, cli };
}

async function hardReinstallCli(options: RegisterOptions): Promise<RegisterTargetResult> {
  let state: Awaited<ReturnType<typeof probeClaudeRegistration>>;
  try {
    state = await probeClaudeRegistration(
      options.homedir,
      options.unpackedDistIndexJsPath,
    );
  } catch (err) {
    return {
      target: 'cli',
      status: 'failed',
      detail: `Hard-reinstall: probe of ~/.claude.json failed: ${(err as Error).message}`,
    };
  }

  if (state.kind === 'absent') {
    const cliPresent = await isClaudeCliInstalled();
    if (!cliPresent) {
      return {
        target: 'cli',
        status: 'skipped-target-missing',
        detail: 'Hard-reinstall: `claude` CLI not on PATH; skipping CLI re-register.',
      };
    }
  }

  if (state.kind === 'registered') {
    const removeRes = await claudeMcpRemove();
    if (removeRes.exitCode !== 0) {
      return {
        target: 'cli',
        status: 'failed',
        detail: `Hard-reinstall: claude mcp remove exited ${String(
          removeRes.exitCode,
        )}: ${removeRes.stderr.trim()}`,
      };
    }
  }

  const addRes = await claudeMcpAdd(options.unpackedDistIndexJsPath);
  if (addRes.exitCode !== 0) {
    return {
      target: 'cli',
      status: 'failed',
      detail: `Hard-reinstall: claude mcp add exited ${String(addRes.exitCode)}: ${addRes.stderr.trim()}`,
    };
  }
  return {
    target: 'cli',
    status: 'registered',
    detail: 'Hard-reinstall: CLI re-registered.',
  };
}
