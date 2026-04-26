// Tests for C3: phases/install.ts.
//
// We exercise the real `child_process.spawn` path through the brew + npm test
// shims under tests/fixtures/bin/. The SUT's whole job is correct subprocess
// orchestration (serial ordering, line-by-line stdout streaming, abort-on-
// failure), so mocking spawn would defeat the point. State isolation per test:
//
//   - $CONCIERGE_TEST_BREW_LOG / $CONCIERGE_TEST_NPM_LOG → tempdir log files
//     so we can assert on argv ordering and arity.
//
// `planInstallSteps` is pure — those tests don't touch the shim at all.

import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  planInstallSteps,
  runInstallSteps,
  type InstallStep,
} from '../../src/phases/install.js';
import type { ProbeResult, GwsVersionDetail } from '../../src/types/probe.js';

const FIXTURES_BIN = resolve(__dirname, '../../../../tests/fixtures/bin');
const BREW_SHIM = join(FIXTURES_BIN, 'brew');
const NPM_SHIM = join(FIXTURES_BIN, 'npm');
// Reuse existing per-tool shims for post-install version probes.
const GWS_SHIM = join(FIXTURES_BIN, 'gws');
const CLAUDE_SHIM = join(FIXTURES_BIN, 'claude');

let tmp: string;
let savedEnv: Record<string, string | undefined> = {};

const SHIM_ENV_KEYS = [
  'CONCIERGE_TEST_BREW_LOG',
  'CONCIERGE_TEST_NPM_LOG',
  'CONCIERGE_TEST_BREW_FAIL',
  'CONCIERGE_TEST_BREW_SEARCH_HIT',
  'CONCIERGE_TEST_BREW_PROGRESS_LINES',
  'CONCIERGE_TEST_NPM_FAIL',
];

function snapshotEnv(): void {
  savedEnv = Object.fromEntries(SHIM_ENV_KEYS.map((k) => [k, process.env[k]]));
}

function restoreEnv(): void {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(() => {
  snapshotEnv();
  tmp = mkdtempSync(join(tmpdir(), 'concierge-install-test-'));
  process.env['CONCIERGE_TEST_BREW_LOG'] = join(tmp, 'brew.log');
  process.env['CONCIERGE_TEST_NPM_LOG'] = join(tmp, 'npm.log');
  // Default search hit set: claude-code is found by default. Tests that
  // need npm-fallback override this.
  process.env['CONCIERGE_TEST_BREW_SEARCH_HIT'] = 'claude-code';
});

afterEach(() => {
  restoreEnv();
  rmSync(tmp, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW_ISO = new Date().toISOString();

function probe<T>(
  name: ProbeResult['name'],
  status: ProbeResult['status'],
  detail?: T,
): ProbeResult<T> {
  const r: ProbeResult<T> = { name, status, durationMs: 0, timestamp: NOW_ISO };
  if (detail !== undefined) (r as { detail?: T }).detail = detail;
  return r;
}

function readBrewLog(): string[] {
  const path = process.env['CONCIERGE_TEST_BREW_LOG'];
  if (path === undefined || !existsSync(path)) return [];
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean);
}

function readNpmLog(): string[] {
  const path = process.env['CONCIERGE_TEST_NPM_LOG'];
  if (path === undefined || !existsSync(path)) return [];
  return readFileSync(path, 'utf8').trim().split('\n').filter(Boolean);
}

// ---------------------------------------------------------------------------
// planInstallSteps
// ---------------------------------------------------------------------------

describe('planInstallSteps', () => {
  it('returns no steps when probe array is empty', () => {
    expect(planInstallSteps([])).toEqual([]);
  });

  it('returns no steps when every relevant tool probe is ok', () => {
    const probes: ProbeResult[] = [
      probe('node', 'ok'),
      probe('gws', 'ok'),
      probe('gcloud', 'ok'),
      probe('claude.cli', 'ok'),
      probe('claude.desktop', 'ok'),
    ];
    expect(planInstallSteps(probes)).toEqual([]);
  });

  it('plans an install step for missing node with the correct brew package + non-cask flag', () => {
    const steps = planInstallSteps([probe('node', 'missing')]);
    expect(steps).toHaveLength(1);
    expect(steps[0]).toEqual({
      tool: 'node',
      action: 'install',
      brewPackage: 'node@20',
      isCask: false,
    });
  });

  it('plans missing gws + gcloud in stable serial order (gws before gcloud)', () => {
    const steps = planInstallSteps([
      probe('gcloud', 'missing'),
      probe('gws', 'missing'),
    ]);
    expect(steps.map((s) => s.tool)).toEqual(['gws', 'gcloud']);
    expect(steps[0]).toMatchObject({
      tool: 'gws',
      action: 'install',
      brewPackage: 'googleworkspace-cli',
      isCask: false,
    });
    expect(steps[1]).toMatchObject({
      tool: 'gcloud',
      action: 'install',
      brewPackage: 'google-cloud-sdk',
      isCask: true,
    });
  });

  it('plans an upgrade step when gws.version reports needsUpgrade', () => {
    const detail: GwsVersionDetail = {
      installed: '0.10.0',
      required: '0.22.5',
      needsUpgrade: true,
    };
    const steps = planInstallSteps([
      probe('gws', 'ok'),
      probe<GwsVersionDetail>('gws.version', 'stale', detail),
    ]);
    expect(steps).toEqual([
      {
        tool: 'gws',
        action: 'upgrade',
        brewPackage: 'googleworkspace-cli',
        isCask: false,
      },
    ]);
  });

  it('does not plan an upgrade when gws.version.needsUpgrade is false', () => {
    const detail: GwsVersionDetail = {
      installed: '0.22.5',
      required: '0.22.5',
      needsUpgrade: false,
    };
    expect(
      planInstallSteps([probe<GwsVersionDetail>('gws.version', 'ok', detail)]),
    ).toEqual([]);
  });

  it('prefers install over upgrade when both would apply to gws (defensive — probe statuses are mutually exclusive)', () => {
    const upgradeDetail: GwsVersionDetail = {
      installed: '0.10.0',
      required: '0.22.5',
      needsUpgrade: true,
    };
    const steps = planInstallSteps([
      probe('gws', 'missing'),
      probe<GwsVersionDetail>('gws.version', 'stale', upgradeDetail),
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.action).toBe('install');
  });

  it('plans claude-desktop with --cask using the official "claude" cask name', () => {
    const steps = planInstallSteps([probe('claude.desktop', 'missing')]);
    expect(steps).toEqual([
      {
        tool: 'claude-desktop',
        action: 'install',
        brewPackage: 'claude',
        isCask: true,
      },
    ]);
  });

  it('produces full TOOL_ORDER ordering when every tool is missing', () => {
    const steps = planInstallSteps([
      probe('claude.desktop', 'missing'),
      probe('claude.cli', 'missing'),
      probe('gcloud', 'missing'),
      probe('gws', 'missing'),
      probe('node', 'missing'),
    ]);
    expect(steps.map((s) => s.tool)).toEqual([
      'node',
      'gws',
      'gcloud',
      'claude',
      'claude-desktop',
    ]);
  });
});

// ---------------------------------------------------------------------------
// runInstallSteps
// ---------------------------------------------------------------------------

describe('runInstallSteps', () => {
  const STEP_NODE: InstallStep = {
    tool: 'node',
    action: 'install',
    brewPackage: 'node@20',
    isCask: false,
  };
  const STEP_GWS: InstallStep = {
    tool: 'gws',
    action: 'install',
    brewPackage: 'googleworkspace-cli',
    isCask: false,
  };
  const STEP_GCLOUD: InstallStep = {
    tool: 'gcloud',
    action: 'install',
    brewPackage: 'google-cloud-sdk',
    isCask: true,
  };
  const STEP_CLAUDE: InstallStep = {
    tool: 'claude',
    action: 'install',
    brewPackage: 'claude-code',
    isCask: false,
  };

  it('happy path: 2 steps both complete with version + brew log records both calls in order', async () => {
    const results = await runInstallSteps([STEP_GWS, STEP_GCLOUD], {
      brewBin: BREW_SHIM,
      versionBins: { gws: GWS_SHIM, gcloud: '/usr/bin/true' },
    });
    expect(results).toHaveLength(2);
    expect(results[0]?.status).toBe('installed');
    expect(results[0]?.tool).toBe('gws');
    expect(results[0]?.version).toBe('0.22.5');
    expect(results[1]?.status).toBe('installed');
    expect(results[1]?.tool).toBe('gcloud');
    // brew log preserves call order (gws → gcloud).
    const log = readBrewLog();
    expect(log[0]).toContain('install\tgoogleworkspace-cli');
    expect(log[1]).toContain('install\t--cask\tgoogle-cloud-sdk');
  });

  it('emits opening "→ Installing <tool>" + closing "✓ <tool> ... installed" lines via onProgress', async () => {
    const lines: string[] = [];
    await runInstallSteps([STEP_GWS], {
      brewBin: BREW_SHIM,
      versionBins: { gws: GWS_SHIM },
      onProgress: (l) => lines.push(l),
    });
    // Opening line.
    expect(lines[0]).toBe('→ Installing gws...');
    // At least one shim progress line was streamed (==> Downloading or 🍺 line).
    const sawProgress = lines.some(
      (l) => l.startsWith('==>') || l.includes('🍺'),
    );
    expect(sawProgress).toBe(true);
    // Closing line includes the captured version.
    const closing = lines[lines.length - 1] ?? '';
    expect(closing).toMatch(/^✓ gws 0\.22\.5 installed/);
  });

  it('streams stdout lines from the shim as separate onProgress calls (not one giant blob)', async () => {
    process.env['CONCIERGE_TEST_BREW_PROGRESS_LINES'] = '5';
    const lines: string[] = [];
    await runInstallSteps([STEP_GWS], {
      brewBin: BREW_SHIM,
      versionBins: { gws: GWS_SHIM },
      onProgress: (l) => lines.push(l),
    });
    // Opening + 5 progress + closing = at least 7. We assert >=7 to allow the
    // shim to emit a trailing newline split.
    expect(lines.length).toBeGreaterThanOrEqual(7);
    // Each progress line should be a single line (no embedded \n).
    for (const l of lines) {
      expect(l.includes('\n')).toBe(false);
    }
  });

  it('aborts remaining steps on first failure: failed step has stderr, subsequent steps come back as skipped', async () => {
    process.env['CONCIERGE_TEST_BREW_FAIL'] = 'googleworkspace-cli';
    const results = await runInstallSteps(
      [STEP_GWS, STEP_GCLOUD, STEP_CLAUDE],
      { brewBin: BREW_SHIM, versionBins: { gws: GWS_SHIM } },
    );
    expect(results).toHaveLength(3);
    expect(results[0]?.status).toBe('failed');
    expect(results[0]?.tool).toBe('gws');
    expect(results[0]?.stderr).toContain('simulated failure');
    expect(results[1]?.status).toBe('skipped');
    expect(results[1]?.tool).toBe('gcloud');
    expect(results[2]?.status).toBe('skipped');
    expect(results[2]?.tool).toBe('claude');
    // brew log only has the first call; subsequent steps never ran.
    const log = readBrewLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toContain('install\tgoogleworkspace-cli');
  });

  it('upgrade path uses `brew upgrade` (not install) and reports status: upgraded', async () => {
    const results = await runInstallSteps(
      [
        {
          tool: 'gws',
          action: 'upgrade',
          brewPackage: 'googleworkspace-cli',
          isCask: false,
        },
      ],
      { brewBin: BREW_SHIM, versionBins: { gws: GWS_SHIM } },
    );
    expect(results[0]?.status).toBe('upgraded');
    expect(results[0]?.version).toBe('0.22.5');
    expect(readBrewLog()[0]).toContain('upgrade\tgoogleworkspace-cli');
  });

  it('claude CLI install: brew is used when claudeInstaller="brew" and brew log records the install', async () => {
    const results = await runInstallSteps([STEP_CLAUDE], {
      brewBin: BREW_SHIM,
      versionBins: { claude: CLAUDE_SHIM },
      claudeInstaller: 'brew',
    });
    expect(results[0]?.status).toBe('installed');
    expect(results[0]?.installer).toBe('brew');
    expect(results[0]?.version).toBe('1.0.42');
    const log = readBrewLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toContain('install\tclaude-code');
    expect(readNpmLog()).toEqual([]);
  });

  it('claude CLI install: npm-fallback engages when brew search misses (CONCIERGE_TEST_BREW_SEARCH_HIT empty)', async () => {
    delete process.env['CONCIERGE_TEST_BREW_SEARCH_HIT']; // search misses everything
    const results = await runInstallSteps([STEP_CLAUDE], {
      brewBin: BREW_SHIM,
      npmBin: NPM_SHIM,
      versionBins: { claude: CLAUDE_SHIM },
      // Don't set claudeInstaller — we want the runtime probe to drive the choice.
    });
    expect(results[0]?.status).toBe('installed');
    expect(results[0]?.installer).toBe('npm');
    // brew log only contains the SEARCH call — no install via brew.
    const brewLog = readBrewLog();
    expect(brewLog.every((l) => !l.includes('install\tclaude-code'))).toBe(true);
    // npm log records the install.
    const npmLog = readNpmLog();
    expect(npmLog).toHaveLength(1);
    expect(npmLog[0]).toContain('install\t-g\t@anthropic-ai/claude-code');
  });

  it('claude CLI install: brew is preferred when search hits (default env path)', async () => {
    // CONCIERGE_TEST_BREW_SEARCH_HIT=claude-code is set in beforeEach.
    const results = await runInstallSteps([STEP_CLAUDE], {
      brewBin: BREW_SHIM,
      npmBin: NPM_SHIM,
      versionBins: { claude: CLAUDE_SHIM },
    });
    expect(results[0]?.installer).toBe('brew');
    expect(readNpmLog()).toEqual([]);
  });

  it('returns empty array for empty step list (no-op)', async () => {
    const results = await runInstallSteps([], { brewBin: BREW_SHIM });
    expect(results).toEqual([]);
  });

  it('claude-desktop install path: --cask flag is passed and no version probe is attempted', async () => {
    const step: InstallStep = {
      tool: 'claude-desktop',
      action: 'install',
      brewPackage: 'claude',
      isCask: true,
    };
    const results = await runInstallSteps([step], { brewBin: BREW_SHIM });
    expect(results[0]?.status).toBe('installed');
    expect(results[0]?.version).toBeUndefined(); // no --version on a GUI cask
    expect(readBrewLog()[0]).toContain('install\t--cask\tclaude');
  });

  it('node install: streams brew output and captures node version from a shim that mimics `v20.x.y`', async () => {
    // Use /bin/echo via a wrapper isn't quite right (echo doesn't accept
    // --version cleanly). Instead, point versionBins.node at a helper that
    // emits a v-prefixed version. Easiest cross-platform: use `printf` via
    // /bin/sh -c. But spawn() doesn't run shell, so we use `node` itself with
    // -e — every dev env running this test has node. node --version emits
    // its own real version, which is fine for proving the parser.
    const results = await runInstallSteps([STEP_NODE], {
      brewBin: BREW_SHIM,
      versionBins: { node: 'node' },
    });
    expect(results[0]?.status).toBe('installed');
    // node --version emits something like `v20.10.0`; parser strips the `v`.
    expect(results[0]?.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});
