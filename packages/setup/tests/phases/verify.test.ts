// C6 tests: phases/verify.ts.
//
// Strategy:
//   - Use the B5 fixture MCP server (tests/fixtures/mcp-server.js) for the
//     spawn-server check. It supports FIXTURE_MODE / FIXTURE_BUILD_ID env
//     overrides, plus a FIXTURE_INVOCATION_LOG file that the fixture appends
//     to on startup (used to count spawns for the shared-spawn assertion).
//   - Use real fs for the Desktop sha256 check — point homedir at a tempdir
//     and write a fake unpacked extension at the manifest's namespace.
//   - Use real fs for the CLI ~/.claude.json probe (probeClaudeRegistration
//     reads this directly via fs/promises).
//   - Tests NEVER touch real ~/Library/Application Support/Claude/ or real
//     ~/.claude.json — homedir is always a fresh os.tmpdir() entry.

import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { verifyInstall } from '../../src/phases/verify.js';
import type { EmbeddedManifest } from '../../src/types/manifest.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// Use the verify-test wrapper (which re-imports mcp-server.js under a
// distinct filename) so the spawnClient.test.ts orphan-detection regex
// `fixtures/mcp-server\.js` doesn't catch verify-test spawns running in
// parallel.
const FIXTURE = join(HERE, '..', 'fixtures', 'verify-mcp-server.js');

const NAMESPACE = 'local.mcpb.test-author.test-vendor';
const FIXED_BUILD_ID = 'verify-test-build-001';

const FIXTURE_ENV_KEYS = [
  'FIXTURE_MODE',
  'FIXTURE_BUILD_ID',
  'FIXTURE_BUILD_TIME',
  'FIXTURE_INVOCATION_LOG',
] as const;

interface Bed {
  homedir: string;
  unpackedDistIndexJsPath: string;
  manifest: EmbeddedManifest;
  invocationLog: string;
}

function setupBed(): Bed {
  const tmp = mkdtempSync(join(tmpdir(), 'verify-test-'));
  const homedir = join(tmp, 'home');
  mkdirSync(homedir, { recursive: true });

  // The orchestrator-owned unpacked dist/index.js. We point it at the B5
  // fixture MCP server — that's the binary the spawn check exercises.
  const unpackedDistIndexJsPath = FIXTURE;

  // Build the Claude Desktop extension dir + a dist/index.js with known sha.
  // The fixture-server contents serve as a stand-in payload; whatever we
  // write here, the manifest's expected sha256 must match for the cheap
  // check to pass.
  const desktopDist = join(
    homedir,
    'Library',
    'Application Support',
    'Claude',
    'Claude Extensions',
    NAMESPACE,
    'dist',
  );
  mkdirSync(desktopDist, { recursive: true });
  const desktopBytes = Buffer.from('// fake desktop extension dist/index.js\n');
  writeFileSync(join(desktopDist, 'index.js'), desktopBytes);
  const expectedSha = createHash('sha256').update(desktopBytes).digest('hex');

  const manifest: EmbeddedManifest = {
    schemaVersion: 1,
    bundledMcpb: {
      filename: 'Concierge-Test-0.0.0-darwin-arm64.mcpb',
      version: '0.0.0',
      sha256: expectedSha,
      arch: 'darwin-arm64',
      namespace: NAMESPACE,
      buildId: FIXED_BUILD_ID,
      buildTime: '2026-04-25T00:00:00Z',
      sourceCommit: '0'.repeat(40),
    },
    setupVersion: '0.0.0',
  };

  const invocationLog = join(tmp, 'invocations.log');

  return { homedir, unpackedDistIndexJsPath, manifest, invocationLog };
}

/** Write a ~/.claude.json with `mcpServers.concierge.args[0] === expected`. */
function writeClaudeJson(homedir: string, args0: string): void {
  const data = {
    mcpServers: {
      concierge: {
        type: 'stdio' as const,
        command: process.execPath,
        args: [args0],
        scope: 'user' as const,
      },
    },
  };
  writeFileSync(join(homedir, '.claude.json'), JSON.stringify(data, null, 2));
}

let cleanups: string[] = [];

beforeEach(() => {
  cleanups = [];
});

afterEach(() => {
  for (const k of FIXTURE_ENV_KEYS) delete process.env[k];
  for (const path of cleanups) {
    rmSync(path, { recursive: true, force: true });
  }
});

function track<T extends Bed>(bed: T): T {
  // The bed's homedir is rooted at a freshly-mkdtemp'd parent. Recover the
  // parent (one level up) so cleanup nukes the whole sandbox.
  cleanups.push(dirname(bed.homedir));
  return bed;
}

describe('verifyInstall (C6)', () => {
  it('both targets pass: sha matches, claude.json matches, spawn returns matching build_id', async () => {
    const bed = track(setupBed());
    writeClaudeJson(bed.homedir, bed.unpackedDistIndexJsPath);

    process.env['FIXTURE_MODE'] = 'happy';
    process.env['FIXTURE_BUILD_ID'] = FIXED_BUILD_ID;
    process.env['FIXTURE_INVOCATION_LOG'] = bed.invocationLog;

    const result = await verifyInstall({
      manifest: bed.manifest,
      unpackedDistIndexJsPath: bed.unpackedDistIndexJsPath,
      homedir: bed.homedir,
      targets: { desktop: true, cli: true },
      spawnInitTimeoutMs: 2000,
      spawnToolCallTimeoutMs: 2000,
    });

    expect(result.allTargetsPassed).toBe(true);
    expect(result.desktop).toEqual({ target: 'desktop', pass: true });
    expect(result.cli).toEqual({ target: 'cli', pass: true });
  });

  it('desktop sha mismatch short-circuits before spawn for that target', async () => {
    const bed = track(setupBed());
    // Corrupt the on-disk file so the cheap check fails.
    const desktopDist = join(
      bed.homedir,
      'Library',
      'Application Support',
      'Claude',
      'Claude Extensions',
      NAMESPACE,
      'dist',
      'index.js',
    );
    writeFileSync(desktopDist, '// CORRUPTED contents\n');
    writeClaudeJson(bed.homedir, bed.unpackedDistIndexJsPath);

    process.env['FIXTURE_MODE'] = 'happy';
    process.env['FIXTURE_BUILD_ID'] = FIXED_BUILD_ID;
    process.env['FIXTURE_INVOCATION_LOG'] = bed.invocationLog;

    const result = await verifyInstall({
      manifest: bed.manifest,
      unpackedDistIndexJsPath: bed.unpackedDistIndexJsPath,
      homedir: bed.homedir,
      targets: { desktop: true, cli: true },
      spawnInitTimeoutMs: 2000,
      spawnToolCallTimeoutMs: 2000,
    });

    expect(result.allTargetsPassed).toBe(false);
    expect(result.desktop).toEqual({
      target: 'desktop',
      pass: false,
      failureMode: 'sha-mismatch',
    });
    // CLI still runs — and passes (cheap + spawn).
    expect(result.cli).toEqual({ target: 'cli', pass: true });
  });

  it('CLI not registered: failureMode is cli-not-registered', async () => {
    const bed = track(setupBed());
    // Intentionally do NOT write ~/.claude.json.

    process.env['FIXTURE_MODE'] = 'happy';
    process.env['FIXTURE_BUILD_ID'] = FIXED_BUILD_ID;
    process.env['FIXTURE_INVOCATION_LOG'] = bed.invocationLog;

    const result = await verifyInstall({
      manifest: bed.manifest,
      unpackedDistIndexJsPath: bed.unpackedDistIndexJsPath,
      homedir: bed.homedir,
      targets: { desktop: true, cli: true },
      spawnInitTimeoutMs: 2000,
      spawnToolCallTimeoutMs: 2000,
    });

    expect(result.allTargetsPassed).toBe(false);
    expect(result.cli).toEqual({
      target: 'cli',
      pass: false,
      failureMode: 'cli-not-registered',
    });
    // Desktop still verifies fully.
    expect(result.desktop).toEqual({ target: 'desktop', pass: true });
  });

  it('CLI path mismatch: failureMode is cli-path-mismatch', async () => {
    const bed = track(setupBed());
    writeClaudeJson(bed.homedir, '/some/other/wrong/path/dist/index.js');

    process.env['FIXTURE_MODE'] = 'happy';
    process.env['FIXTURE_BUILD_ID'] = FIXED_BUILD_ID;
    process.env['FIXTURE_INVOCATION_LOG'] = bed.invocationLog;

    const result = await verifyInstall({
      manifest: bed.manifest,
      unpackedDistIndexJsPath: bed.unpackedDistIndexJsPath,
      homedir: bed.homedir,
      targets: { desktop: true, cli: true },
      spawnInitTimeoutMs: 2000,
      spawnToolCallTimeoutMs: 2000,
    });

    expect(result.allTargetsPassed).toBe(false);
    expect(result.cli).toEqual({
      target: 'cli',
      pass: false,
      failureMode: 'cli-path-mismatch',
    });
  });

  it('build_id mismatch: spawn-server returns wrong build_id → both targets fail with build-id-mismatch', async () => {
    const bed = track(setupBed());
    writeClaudeJson(bed.homedir, bed.unpackedDistIndexJsPath);

    process.env['FIXTURE_MODE'] = 'happy';
    process.env['FIXTURE_BUILD_ID'] = 'WRONG-BUILD-ID-xyz';
    process.env['FIXTURE_INVOCATION_LOG'] = bed.invocationLog;

    const result = await verifyInstall({
      manifest: bed.manifest,
      unpackedDistIndexJsPath: bed.unpackedDistIndexJsPath,
      homedir: bed.homedir,
      targets: { desktop: true, cli: true },
      spawnInitTimeoutMs: 2000,
      spawnToolCallTimeoutMs: 2000,
    });

    expect(result.allTargetsPassed).toBe(false);
    expect(result.desktop?.pass).toBe(false);
    expect(result.desktop?.failureMode).toBe('build-id-mismatch');
    expect(result.desktop?.expectedBuildId).toBe(FIXED_BUILD_ID);
    expect(result.desktop?.actualBuildId).toBe('WRONG-BUILD-ID-xyz');
    expect(result.cli?.pass).toBe(false);
    expect(result.cli?.failureMode).toBe('build-id-mismatch');
    expect(result.cli?.expectedBuildId).toBe(FIXED_BUILD_ID);
    expect(result.cli?.actualBuildId).toBe('WRONG-BUILD-ID-xyz');
  });

  it('spawn init timeout: failureMode is spawn-timeout', async () => {
    const bed = track(setupBed());
    writeClaudeJson(bed.homedir, bed.unpackedDistIndexJsPath);

    process.env['FIXTURE_MODE'] = 'init-hang';
    process.env['FIXTURE_INVOCATION_LOG'] = bed.invocationLog;

    const result = await verifyInstall({
      manifest: bed.manifest,
      unpackedDistIndexJsPath: bed.unpackedDistIndexJsPath,
      homedir: bed.homedir,
      targets: { desktop: true, cli: true },
      spawnInitTimeoutMs: 600,
      spawnToolCallTimeoutMs: 600,
    });

    expect(result.allTargetsPassed).toBe(false);
    expect(result.desktop?.failureMode).toBe('spawn-timeout');
    expect(result.cli?.failureMode).toBe('spawn-timeout');
  });

  it('shared-spawn optimization: with both targets present, fixture is spawned exactly once', async () => {
    const bed = track(setupBed());
    writeClaudeJson(bed.homedir, bed.unpackedDistIndexJsPath);

    process.env['FIXTURE_MODE'] = 'happy';
    process.env['FIXTURE_BUILD_ID'] = FIXED_BUILD_ID;
    process.env['FIXTURE_INVOCATION_LOG'] = bed.invocationLog;

    const result = await verifyInstall({
      manifest: bed.manifest,
      unpackedDistIndexJsPath: bed.unpackedDistIndexJsPath,
      homedir: bed.homedir,
      targets: { desktop: true, cli: true },
      spawnInitTimeoutMs: 2000,
      spawnToolCallTimeoutMs: 2000,
    });

    expect(result.allTargetsPassed).toBe(true);

    // The fixture appended one line per startup; expect exactly 1 line.
    const log = readFileSync(bed.invocationLog, 'utf8');
    const lines = log.split('\n').filter((l) => l.trim() !== '');
    expect(lines.length).toBe(1);
  });

  it('only desktop present (cli: false): only desktop result populated; allTargetsPassed reflects only desktop', async () => {
    const bed = track(setupBed());
    // No claude.json needed — CLI is skipped.

    process.env['FIXTURE_MODE'] = 'happy';
    process.env['FIXTURE_BUILD_ID'] = FIXED_BUILD_ID;
    process.env['FIXTURE_INVOCATION_LOG'] = bed.invocationLog;

    const result = await verifyInstall({
      manifest: bed.manifest,
      unpackedDistIndexJsPath: bed.unpackedDistIndexJsPath,
      homedir: bed.homedir,
      targets: { desktop: true, cli: false },
      spawnInitTimeoutMs: 2000,
      spawnToolCallTimeoutMs: 2000,
    });

    expect(result.allTargetsPassed).toBe(true);
    expect(result.desktop).toEqual({ target: 'desktop', pass: true });
    expect(result.cli).toBeUndefined();
  });

  it('only CLI present (desktop: false): only cli result populated; works even if Desktop dir missing', async () => {
    const bed = track(setupBed());
    writeClaudeJson(bed.homedir, bed.unpackedDistIndexJsPath);

    process.env['FIXTURE_MODE'] = 'happy';
    process.env['FIXTURE_BUILD_ID'] = FIXED_BUILD_ID;
    process.env['FIXTURE_INVOCATION_LOG'] = bed.invocationLog;

    const result = await verifyInstall({
      manifest: bed.manifest,
      unpackedDistIndexJsPath: bed.unpackedDistIndexJsPath,
      homedir: bed.homedir,
      targets: { desktop: false, cli: true },
      spawnInitTimeoutMs: 2000,
      spawnToolCallTimeoutMs: 2000,
    });

    expect(result.allTargetsPassed).toBe(true);
    expect(result.cli).toEqual({ target: 'cli', pass: true });
    expect(result.desktop).toBeUndefined();
  });

  it('tool-call error: spawn returns isError → failureMode is tool-call-error', async () => {
    const bed = track(setupBed());
    writeClaudeJson(bed.homedir, bed.unpackedDistIndexJsPath);

    process.env['FIXTURE_MODE'] = 'tool-error';
    process.env['FIXTURE_INVOCATION_LOG'] = bed.invocationLog;

    const result = await verifyInstall({
      manifest: bed.manifest,
      unpackedDistIndexJsPath: bed.unpackedDistIndexJsPath,
      homedir: bed.homedir,
      targets: { desktop: true, cli: true },
      spawnInitTimeoutMs: 2000,
      spawnToolCallTimeoutMs: 2000,
    });

    expect(result.allTargetsPassed).toBe(false);
    expect(result.desktop?.failureMode).toBe('tool-call-error');
    expect(result.cli?.failureMode).toBe('tool-call-error');
  });

  it('spawn-failed: non-existent dist path → failureMode is spawn-failed', async () => {
    const bed = track(setupBed());
    writeClaudeJson(bed.homedir, '/definitely/missing/dist/index.js');

    const result = await verifyInstall({
      manifest: bed.manifest,
      unpackedDistIndexJsPath: '/definitely/missing/dist/index.js',
      homedir: bed.homedir,
      targets: { desktop: true, cli: true },
      spawnInitTimeoutMs: 1500,
      spawnToolCallTimeoutMs: 1500,
    });

    expect(result.allTargetsPassed).toBe(false);
    // Desktop cheap check still passes (the orchestrator-owned path is used
    // only for spawn; Desktop sha256 is on the Claude-Desktop-managed dir).
    // CLI cheap check passes too because args[0] matches the (missing) path.
    // Both reach the spawn step and fail there.
    expect(['spawn-failed', 'spawn-timeout']).toContain(
      result.desktop?.failureMode,
    );
    expect(['spawn-failed', 'spawn-timeout']).toContain(
      result.cli?.failureMode,
    );
  });

  it('shared-spawn skipped when both cheap checks fail: fixture never spawned', async () => {
    const bed = track(setupBed());
    // Desktop: corrupt sha. CLI: missing claude.json.
    const desktopDist = join(
      bed.homedir,
      'Library',
      'Application Support',
      'Claude',
      'Claude Extensions',
      NAMESPACE,
      'dist',
      'index.js',
    );
    writeFileSync(desktopDist, '// CORRUPT\n');

    process.env['FIXTURE_MODE'] = 'happy';
    process.env['FIXTURE_BUILD_ID'] = FIXED_BUILD_ID;
    process.env['FIXTURE_INVOCATION_LOG'] = bed.invocationLog;

    const result = await verifyInstall({
      manifest: bed.manifest,
      unpackedDistIndexJsPath: bed.unpackedDistIndexJsPath,
      homedir: bed.homedir,
      targets: { desktop: true, cli: true },
      spawnInitTimeoutMs: 2000,
      spawnToolCallTimeoutMs: 2000,
    });

    expect(result.allTargetsPassed).toBe(false);
    expect(result.desktop?.failureMode).toBe('sha-mismatch');
    expect(result.cli?.failureMode).toBe('cli-not-registered');

    // The optimization: with no pass-eligible target, spawn is skipped.
    let lines: string[] = [];
    try {
      const log = readFileSync(bed.invocationLog, 'utf8');
      lines = log.split('\n').filter((l) => l.trim() !== '');
    } catch {
      // file may not exist if fixture never spawned — that's the assertion
    }
    expect(lines.length).toBe(0);
  });
});
