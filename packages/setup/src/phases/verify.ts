// C6: End-to-end verification phase. Implements the locked verification policy
// from `docs/specs/setup-hardening-v2/spec.md` §Verification Policy.
//
// For each PRESENT Claude target (Desktop / CLI):
//   1. Cheap check first
//      - Desktop: static sha256 of <Claude Extensions>/<namespace>/dist/index.js
//        equals manifest.bundledMcpb.sha256.
//      - CLI:     `mcpServers.concierge` present in ~/.claude.json with
//        args[0] === expected absolute path (the orchestrator-owned unpacked
//        dist/index.js, per D14 TOCTOU mitigation — NOT the Claude-Desktop-
//        managed extension dir, which can be replaced underfoot).
//   2. Spawn check (if cheap check passes)
//      - `node <unpackedDistIndexJsPath>` over stdio MCP.
//      - Compare returned `buildId` to `manifest.bundledMcpb.buildId`.
//
// AND semantics: a target either fully passes (cheap + spawn) or fully fails.
// Absent targets (skipped) are treated as pass-by-default (don't block).
//
// Shared-spawn optimization (per spec §Verification Policy: "Both targets use
// the same spawn-server invocation against the same unpacked dist/index.js"):
// the spawn-server check runs at most ONCE per orchestrator run. If both
// targets are present and both pass their cheap checks, the single spawn
// outcome is attributed to both targets. If one cheap check fails, the spawn
// is still run for the other target (the pass-eligible one).

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { callConciergeInfo, type SpawnError } from '../mcp/spawnClient.js';
import { probeClaudeRegistration } from '../state/claudeJson.js';
import type { EmbeddedManifest } from '../types/manifest.js';

export type ClaudeTarget = 'desktop' | 'cli';

export type VerifyFailureMode =
  | 'sha-mismatch'
  | 'cli-not-registered'
  | 'cli-path-mismatch'
  | 'spawn-failed'
  | 'spawn-timeout'
  | 'build-id-mismatch'
  | 'protocol-error'
  | 'tool-call-error';

export interface VerifyTargetResult {
  target: ClaudeTarget;
  pass: boolean;
  /** Which check failed (only set when pass: false). */
  failureMode?: VerifyFailureMode;
  expectedBuildId?: string;
  actualBuildId?: string;
  stderr?: string;
}

export interface VerifyResult {
  desktop?: VerifyTargetResult;
  cli?: VerifyTargetResult;
  /** True iff every PRESENT target verified. Absent targets don't block. */
  allTargetsPassed: boolean;
}

export interface VerifyOptions {
  manifest: EmbeddedManifest;
  /**
   * Path to the orchestrator-owned `mktemp -d` extraction (per D14 TOCTOU
   * mitigation). The spawn-server check is performed against THIS file, not
   * the Claude-Desktop-managed extension directory.
   */
  unpackedDistIndexJsPath: string;
  /** User homedir. */
  homedir: string;
  /** Whether each target is present. If false, that target is skipped. */
  targets: { desktop: boolean; cli: boolean };
  /** Override timeouts (test only). */
  spawnInitTimeoutMs?: number;
  spawnToolCallTimeoutMs?: number;
}

/**
 * Compute sha256 of a file. Returns lowercase hex. Throws on read error so
 * the caller can distinguish "file missing" (an installer bug) from "file
 * present but content mismatch" (a stale-install bug).
 */
async function sha256OfFile(absPath: string): Promise<string> {
  const buf = await readFile(absPath);
  return createHash('sha256').update(buf).digest('hex');
}

/** Build the absolute path to the Claude Desktop extension's unpacked dist/index.js. */
function desktopExtensionDistPath(homedir: string, namespace: string): string {
  return join(
    homedir,
    'Library',
    'Application Support',
    'Claude',
    'Claude Extensions',
    namespace,
    'dist',
    'index.js',
  );
}

/** Map a SpawnError.kind to one of the verify failure modes. */
function spawnErrorToFailureMode(kind: SpawnError['kind']): VerifyFailureMode {
  switch (kind) {
    case 'spawn-failed':
      return 'spawn-failed';
    case 'init-timeout':
    case 'tool-call-timeout':
      return 'spawn-timeout';
    case 'tool-call-error':
      return 'tool-call-error';
    case 'protocol-error':
      return 'protocol-error';
    case 'exit-nonzero':
      // Child died before/during handshake — closest semantic is spawn-failed.
      return 'spawn-failed';
    default:
      return 'protocol-error';
  }
}

/**
 * Internal helper: build a failure result, omitting optional fields entirely
 * (exactOptionalPropertyTypes — set keys are not the same as undefined keys).
 */
function failTarget(
  target: ClaudeTarget,
  failureMode: VerifyFailureMode,
  extras: Partial<{
    expectedBuildId: string;
    actualBuildId: string;
    stderr: string;
  }> = {},
): VerifyTargetResult {
  const result: VerifyTargetResult = { target, pass: false, failureMode };
  if (extras.expectedBuildId !== undefined) {
    result.expectedBuildId = extras.expectedBuildId;
  }
  if (extras.actualBuildId !== undefined) {
    result.actualBuildId = extras.actualBuildId;
  }
  if (extras.stderr !== undefined && extras.stderr !== '') {
    result.stderr = extras.stderr;
  }
  return result;
}

/**
 * Run the locked verification policy against all present Claude targets.
 *
 * Per-target ordering: cheap check → spawn check. AND semantics: any target
 * failing fails the run. Absent targets (skipped) are treated as pass-by-
 * default and do not block.
 *
 * Spawn-server check is shared across targets: at most one invocation per
 * orchestrator run, even when both targets are present.
 */
export async function verifyInstall(
  options: VerifyOptions,
): Promise<VerifyResult> {
  const { manifest, unpackedDistIndexJsPath, homedir, targets } = options;
  const expectedBuildId = manifest.bundledMcpb.buildId;
  const expectedSha256 = manifest.bundledMcpb.sha256;
  const namespace = manifest.bundledMcpb.namespace;

  let desktop: VerifyTargetResult | undefined;
  let cli: VerifyTargetResult | undefined;

  // ----- Desktop cheap check -----------------------------------------------
  // Track whether desktop is still in the running for the spawn outcome.
  let desktopNeedsSpawn = false;
  if (targets.desktop) {
    const desktopDist = desktopExtensionDistPath(homedir, namespace);
    try {
      const actualSha = await sha256OfFile(desktopDist);
      if (actualSha !== expectedSha256) {
        desktop = failTarget('desktop', 'sha-mismatch');
      } else {
        desktopNeedsSpawn = true;
      }
    } catch {
      // File missing (or unreadable) ⇒ extension not installed for this
      // namespace, or stale dir. Treat as sha-mismatch (cheap-check failure).
      desktop = failTarget('desktop', 'sha-mismatch');
    }
  }

  // ----- CLI cheap check ---------------------------------------------------
  let cliNeedsSpawn = false;
  if (targets.cli) {
    const state = await probeClaudeRegistration(
      homedir,
      unpackedDistIndexJsPath,
    );
    if (state.kind === 'absent' || state.kind === 'no_concierge') {
      cli = failTarget('cli', 'cli-not-registered');
    } else if (!state.matches) {
      cli = failTarget('cli', 'cli-path-mismatch');
    } else {
      cliNeedsSpawn = true;
    }
  }

  // ----- Shared spawn check -----------------------------------------------
  // Per spec §Verification Policy: both targets use the SAME spawn-server
  // invocation against the SAME unpacked dist/index.js. Run it ONCE if any
  // pass-eligible target needs it, and attribute the outcome to both.
  if (desktopNeedsSpawn || cliNeedsSpawn) {
    const spawnOpts: Parameters<typeof callConciergeInfo>[0] = {
      distIndexJsAbsPath: unpackedDistIndexJsPath,
    };
    if (options.spawnInitTimeoutMs !== undefined) {
      spawnOpts.initTimeoutMs = options.spawnInitTimeoutMs;
    }
    if (options.spawnToolCallTimeoutMs !== undefined) {
      spawnOpts.toolCallTimeoutMs = options.spawnToolCallTimeoutMs;
    }

    const spawnResult = await callConciergeInfo(spawnOpts);

    if (spawnResult.ok) {
      const actualBuildId = spawnResult.data.buildId;
      const buildIdMatches = actualBuildId === expectedBuildId;
      if (desktopNeedsSpawn) {
        desktop = buildIdMatches
          ? { target: 'desktop', pass: true }
          : failTarget('desktop', 'build-id-mismatch', {
              expectedBuildId,
              actualBuildId,
            });
      }
      if (cliNeedsSpawn) {
        cli = buildIdMatches
          ? { target: 'cli', pass: true }
          : failTarget('cli', 'build-id-mismatch', {
              expectedBuildId,
              actualBuildId,
            });
      }
    } else {
      const failureMode = spawnErrorToFailureMode(spawnResult.error.kind);
      const stderr = spawnResult.error.stderr;
      const extras: Parameters<typeof failTarget>[2] = {};
      if (stderr !== undefined && stderr !== '') extras.stderr = stderr;
      if (desktopNeedsSpawn) {
        desktop = failTarget('desktop', failureMode, extras);
      }
      if (cliNeedsSpawn) {
        cli = failTarget('cli', failureMode, extras);
      }
    }
  }

  // ----- Aggregate ---------------------------------------------------------
  // AND semantics: every present target must pass. Absent targets are skipped
  // (left undefined) and treated as pass-by-default — they don't block.
  const desktopOk = desktop === undefined ? true : desktop.pass;
  const cliOk = cli === undefined ? true : cli.pass;
  const allTargetsPassed = desktopOk && cliOk;

  const result: VerifyResult = { allTargetsPassed };
  if (desktop !== undefined) result.desktop = desktop;
  if (cli !== undefined) result.cli = cli;
  return result;
}
