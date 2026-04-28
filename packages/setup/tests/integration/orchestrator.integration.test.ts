// G6 (setup-hardening-v2 wave 12): macos-14 integration test for the
// orchestrator pipeline.
//
// Strategy
// --------
// G6 exercises the orchestrator's COMPOSITION end-to-end on a macos-14 CI
// runner with the F2 shimmed `claude` and `gws` binaries on PATH. Two
// scenarios are required by the spec:
//
//   A. Happy path  : probe → install → consent → oauth → register → verify
//                    → success. Asserts exit 0 and the success-screen lines
//                    fire in the recording UI sink.
//   B. Stale install: pre-create a fixture extension dir whose dist/index.js
//                    sha256 mismatches the manifest. The orchestrator's
//                    verify-then-recover-then-reverify path must run, and
//                    the second verify pass must succeed
//                    (`outcome === 'recovered_after_retry'`).
//   B'. Stale install + recovery still fails: same as B but the second verify
//      also fails. Asserts `outcome === 'failure'` and that runRecovery is
//      invoked exactly ONCE (the 1-retry budget is honored).
//
// Mocking decisions (documented per task brief)
// ---------------------------------------------
// 1. We `vi.mock('../../src/phases/probe.js')`, install.js, oauth.js, and
//    updateCheck.js. Reason: those phases require fully-shimmed gcloud,
//    fully-staged Claude.app, etc. Standing all of that up is its own
//    multi-day effort and is NOT the focus of G6 — G6 is about end-to-end
//    composition through the verify+recovery branch. The shimmed
//    `claude`/`gws`/`brew` binaries on PATH are still active for the parts
//    of the pipeline we don't mock (registerClaude, hardReinstallSequence).
//
// 2. We MOCK `../../src/mcp/spawnClient.js` so verifyInstall does not
//    actually spawn a Node child process running an MCP server. The mock
//    returns either:
//      - happy buildId match (Scenario A and B's post-recovery verify), or
//      - a missing-buildId failure (forces verify into the recovery path).
//    A counter tracks how many spawn calls the test issued so we can
//    assert the verify-then-reverify sequence.
//
// 3. We use REAL implementations of:
//      - phases/claudeRegister.ts (registerClaude — exercises the shimmed
//                                  `claude`/`open`/`osascript` binaries)
//      - state/manifest.ts        (manifest read from staged assets dir)
//      - lock.ts, log.ts          (real lockfile + log file lifecycle)
//
//    For Scenario A we ALSO use real verify.ts (cheap-check sha256 against a
//    staged GOOD-bytes extension dir). Scenarios B and B' mock verifyInstall
//    + runRecovery to deterministically inject the "first verify fails →
//    recovery decides outcome" sequence — that's the orchestrator-composition
//    contract under test, and avoids fighting registerDesktop's pre-emptive
//    stale-cleanup which would race a file-system-based stale fixture.
//
// 4. PATH contains BOTH the repo-root tests/fixtures/bin (claude, gws,
//    brew, npm, open, osascript shims) AND `/usr/bin:/bin:/opt/homebrew/bin`
//    so node, tar, mktemp etc. resolve. Per CLAUDE.md, ubuntu's symlink leak
//    of /usr/bin/gcloud is not an issue on macos-14, so we keep the system
//    paths.
//
// Gating: skipped unless CONCIERGE_SETUP_INTEGRATION=1. CI's
// `setup-orchestrator` job in .github/workflows/ci.yml passes that env var.

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';

const INTEGRATION = process.env['CONCIERGE_SETUP_INTEGRATION'] === '1';

// ---------------------------------------------------------------------------
// Mocks — declared at module scope per vitest hoisting requirements.
// ---------------------------------------------------------------------------

vi.mock('../../src/phases/probe.js', () => ({
  runAllProbes: vi.fn(),
}));
vi.mock('../../src/phases/install.js', () => ({
  planInstallSteps: vi.fn(() => []),
  runInstallSteps: vi.fn(async () => []),
}));
vi.mock('../../src/phases/oauth.js', () => ({
  runGwsAuthSetup: vi.fn(async () => ({ kind: 'ok', projectId: 'p1' })),
  runGwsAuthLogin: vi.fn(async () => ({
    kind: 'ok',
    user: 'ceo@pashion.example',
    tokenValid: true,
    scopes: ['gmail'],
  })),
  classifyAccountDomain: vi.fn(() => 'workspace'),
}));
vi.mock('../../src/phases/updateCheck.js', () => ({
  checkForUpdate: vi.fn(async () => ({ newer: false })),
}));
vi.mock('../../src/mcp/spawnClient.js', () => ({
  callConciergeInfo: vi.fn(),
}));
// verify + recover are mocked for Scenario B/B' so we can deterministically
// drive the verify-then-recover sequence. Scenario A overrides these with
// the REAL implementations via vi.importActual.
vi.mock('../../src/phases/verify.js', () => ({
  verifyInstall: vi.fn(),
}));
vi.mock('../../src/phases/recover.js', () => ({
  runRecovery: vi.fn(),
}));

// Imports must come AFTER vi.mock so the mocked surfaces resolve.
import { runAllProbes } from '../../src/phases/probe.js';
import { runOrchestrator, type UISink } from '../../src/orchestrator.js';
import { callConciergeInfo } from '../../src/mcp/spawnClient.js';
import { verifyInstall } from '../../src/phases/verify.js';
import { runRecovery } from '../../src/phases/recover.js';
import type { ProbeResult } from '../../src/types/probe.js';
import type { EmbeddedManifest } from '../../src/types/manifest.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Repo-root tests/fixtures/bin (shipped by F2). The integration test relies on
// these being on PATH so any subprocess call from registerClaude /
// hardReinstallSequence (claude, open, osascript) hits a shim.
const REPO_FIXTURE_BIN = resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'tests',
  'fixtures',
  'bin',
);

// Stable manifest baked for the test. The sha256 here MUST match the bytes we
// write to the staged dist/index.js in `stageExtensionFixture(..., GOOD)`.
const NAMESPACE = 'local.mcpb.justin-stottlemyer.concierge-google-workspace';
const MCPB_VERSION = '0.0.0-integration';
const BUILD_ID = 'integration-build-001';
const BUILD_TIME = '2026-04-25T00:00:00.000Z';

const GOOD_DIST_BYTES = Buffer.from(
  '// G6 fixture dist/index.js — content matched by manifest sha256.\n',
);
const GOOD_SHA = createHash('sha256').update(GOOD_DIST_BYTES).digest('hex');

const BAD_DIST_BYTES = Buffer.from(
  '// G6 STALE fixture dist/index.js — content sha256 will MISMATCH.\n',
);
// Note: BAD bytes intentionally produce a different sha256 from GOOD_SHA, so
// the cheap-check in verifyInstall fails on a stale install.

function makeManifest(): EmbeddedManifest {
  return {
    schemaVersion: 1,
    bundledMcpb: {
      filename: `Concierge-GoogleWorkspace-${MCPB_VERSION}-darwin-arm64.mcpb`,
      version: MCPB_VERSION,
      sha256: GOOD_SHA,
      arch: 'darwin-arm64',
      namespace: NAMESPACE,
      buildId: BUILD_ID,
      buildTime: BUILD_TIME,
      sourceCommit: 'b'.repeat(40),
    },
    setupVersion: '0.0.0-integration',
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RecordedCall {
  method: string;
  args: unknown[];
}
interface RecordingUI {
  sink: UISink;
  calls: RecordedCall[];
}

function makeRecordingUI(consentAccepted = true): RecordingUI {
  const calls: RecordedCall[] = [];
  const record = (method: string, ...args: unknown[]): void => {
    calls.push({ method, args });
  };
  const sink: UISink = {
    banner: () => record('banner'),
    showProbeProgress: (name, status) => record('showProbeProgress', name, status),
    showConsentScreen: async (text) => {
      record('showConsentScreen', text);
      return { accepted: consentAccepted };
    },
    showInstallProgress: (tool, phase, detail) =>
      record('showInstallProgress', tool, phase, detail),
    showOauthWait: (authUrl) => record('showOauthWait', authUrl),
    showAdminGate: async (text) => {
      record('showAdminGate', text);
    },
    showSuccess: (text) => record('showSuccess', text),
    showFailure: (phase, message, copyable) =>
      record('showFailure', phase, message, copyable),
    showLockCollision: (pid, started) => record('showLockCollision', pid, started),
    showDiagnose: (text) => record('showDiagnose', text),
  };
  return { sink, calls };
}

function probe(
  name: ProbeResult['name'],
  status: ProbeResult['status'],
  detail?: unknown,
): ProbeResult {
  const r: ProbeResult = {
    name,
    status,
    durationMs: 0,
    timestamp: BUILD_TIME,
  };
  if (detail !== undefined) {
    (r as { detail?: unknown }).detail = detail;
  }
  return r;
}

/** Probe set that mirrors a fully-installed, fully-authenticated environment.
 *  All targets present and OK so the orchestrator runs the verify branch. */
function happyProbes(homedir: string, distPath: string): readonly ProbeResult[] {
  return [
    probe('account.domain', 'ok', {
      user: 'ceo@pashion.example',
      domain: 'pashion.example',
      type: 'workspace',
    }),
    probe('brew', 'ok', { version: '4.5.2' }),
    probe('claude.cli', 'ok', { version: '1.0.42', absPath: '/u/local/bin/claude' }),
    probe('claude.desktop', 'ok', {
      absPath: join(homedir, 'Applications', 'Claude.app'),
      appPath: join(homedir, 'Applications'),
    }),
    probe('gcloud', 'ok', { version: '470.0.0' }),
    probe('gcloud.appDefault', 'ok', { hasToken: true }),
    probe('gcp.apisEnabled', 'ok', { project: 'p1', enabled: ['gmail'], missing: [] }),
    probe('gws', 'ok', { version: '0.22.5', absPath: '/u/local/bin/gws' }),
    probe('gws.authStatus', 'ok', {
      user: 'ceo@pashion.example',
      tokenValid: true,
      projectId: 'concierge-test-shim',
      scopes: ['gmail'],
    }),
    probe('gws.clientSecret', 'ok', {
      path: '~/.config/gws/client_secret.json',
      projectId: 'concierge-test-shim',
      placeholderSuspect: false,
      clientIdNumericPrefix: '493302',
    }),
    probe('gws.version', 'ok', {
      installed: '0.22.5',
      required: '0.22.5',
      needsUpgrade: false,
    }),
    probe('mcpb.cli', 'ok', {
      claudeJsonPath: join(homedir, '.claude.json'),
      registered: true,
      expectedAbsPath: distPath,
      actualAbsPath: distPath,
      matches: true,
    }),
    probe('mcpb.desktop', 'ok', {
      unpackedPath: distPath,
      bundledSha: GOOD_SHA,
      installedSha: GOOD_SHA,
      namespace: NAMESPACE,
      matches: true,
    }),
    probe('node', 'ok', { version: '20.10.0', major: 20 }),
    probe('verify.endToEnd', 'skipped'),
  ];
}

/** Pre-populate `~/.claude.json` with a registered concierge entry pointing
 *  at the orchestrator-owned unpacked dist/index.js. registerClaude() in
 *  the happy path is no-op when the entry already matches. */
function preRegisterClaudeJson(homedir: string, distPath: string): void {
  const path = join(homedir, '.claude.json');
  const doc = {
    mcpServers: {
      concierge: {
        type: 'stdio',
        command: 'node',
        args: [distPath],
        scope: 'user',
      },
    },
  };
  writeFileSync(path, JSON.stringify(doc, null, 2));
}

/** Stage a fixture extension dir at the path verifyInstall reads. The bytes
 *  written determine sha256 → caller uses GOOD_DIST_BYTES (manifest match)
 *  or BAD_DIST_BYTES (deliberate mismatch for the stale-install scenario). */
function stageExtensionFixture(
  homedir: string,
  bytes: Buffer,
): string {
  const extDir = join(
    homedir,
    'Library',
    'Application Support',
    'Claude',
    'Claude Extensions',
    NAMESPACE,
  );
  mkdirSync(join(extDir, 'dist'), { recursive: true });
  const distPath = join(extDir, 'dist', 'index.js');
  writeFileSync(distPath, bytes);
  return distPath;
}

/** Stage a tempdir with a manifest.json the orchestrator can read, plus an
 *  empty .mcpb file (only its filename matters; opening it goes through the
 *  shimmed `open` binary and never actually unpacks). */
function stageAssetsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'concierge-int-assets-'));
  const manifest = makeManifest();
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(join(dir, manifest.bundledMcpb.filename), '');
  return dir;
}

/** Stage a fake Claude.app (just a directory). isClaudeDesktopInstalled
 *  uses fs.stat; a directory satisfies the check. */
function stageClaudeApp(homedir: string): string {
  const appDir = join(homedir, 'Applications', 'Claude.app');
  mkdirSync(appDir, { recursive: true });
  return appDir;
}

// ---------------------------------------------------------------------------
// Test-suite fixture lifecycle
// ---------------------------------------------------------------------------

let workTmp: string;
let homedir: string;
let assetsDir: string;
let unpackedDistPath: string;
let savedEnv: Record<string, string | undefined>;
let savedPath: string | undefined;

function snapshotEnv(): void {
  savedEnv = {
    CONCIERGE_TEST_CLAUDE_JSON: process.env['CONCIERGE_TEST_CLAUDE_JSON'],
    CONCIERGE_TEST_GWS_DIR: process.env['CONCIERGE_TEST_GWS_DIR'],
    CONCIERGE_TEST_BREW_LOG: process.env['CONCIERGE_TEST_BREW_LOG'],
    CONCIERGE_TEST_OPEN_LOG: process.env['CONCIERGE_TEST_OPEN_LOG'],
    CONCIERGE_TEST_OSASCRIPT_LOG: process.env['CONCIERGE_TEST_OSASCRIPT_LOG'],
    CONCIERGE_TEST_CLAUDE_APP_PATHS: process.env['CONCIERGE_TEST_CLAUDE_APP_PATHS'],
    CONCIERGE_TEST_CLAUDE_BIN: process.env['CONCIERGE_TEST_CLAUDE_BIN'],
    CONCIERGE_TEST_OPEN_BIN: process.env['CONCIERGE_TEST_OPEN_BIN'],
    CONCIERGE_TEST_OSASCRIPT_BIN: process.env['CONCIERGE_TEST_OSASCRIPT_BIN'],
  };
  savedPath = process.env['PATH'];
}
function restoreEnv(): void {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  if (savedPath === undefined) delete process.env['PATH'];
  else process.env['PATH'] = savedPath;
}

beforeEach(() => {
  vi.clearAllMocks();
  snapshotEnv();

  workTmp = mkdtempSync(join(tmpdir(), 'concierge-orch-int-'));
  homedir = join(workTmp, 'home');
  mkdirSync(homedir, { recursive: true });
  mkdirSync(join(homedir, '.config', 'gws'), { recursive: true });
  mkdirSync(join(homedir, '.config', 'concierge'), { recursive: true });

  // Fake Claude.app so isClaudeDesktopInstalled returns true.
  stageClaudeApp(homedir);

  // Point the test shims at tempdir-scoped state.
  process.env['CONCIERGE_TEST_CLAUDE_JSON'] = join(homedir, '.claude.json');
  process.env['CONCIERGE_TEST_GWS_DIR'] = join(homedir, '.config', 'gws');
  process.env['CONCIERGE_TEST_BREW_LOG'] = join(workTmp, 'brew.log');
  process.env['CONCIERGE_TEST_OPEN_LOG'] = join(workTmp, 'open.log');
  process.env['CONCIERGE_TEST_OSASCRIPT_LOG'] = join(workTmp, 'osascript.log');
  // Override Claude.app discovery to just our staged dir.
  process.env['CONCIERGE_TEST_CLAUDE_APP_PATHS'] = join(
    homedir,
    'Applications',
    'Claude.app',
  );

  // PATH: shims first, then system bins, then homebrew (real `node` for
  // child_process if anything needs it; `tar`/`mktemp` from /usr/bin).
  process.env['PATH'] = [
    REPO_FIXTURE_BIN,
    '/usr/bin',
    '/bin',
    '/opt/homebrew/bin',
  ].join(':');

  assetsDir = stageAssetsDir();
  unpackedDistPath = join(workTmp, 'unpacked', 'dist', 'index.js');
  mkdirSync(dirname(unpackedDistPath), { recursive: true });
  // The orchestrator-owned unpacked file. registerCli's claude mcp add will
  // record this path; verify's CLI cheap-check compares the registered path
  // against this path. Content doesn't matter — spawnClient is mocked.
  writeFileSync(unpackedDistPath, GOOD_DIST_BYTES);

  // Pre-register so registerCli is a no-op (it's idempotent when the
  // existing entry matches).
  preRegisterClaudeJson(homedir, unpackedDistPath);

  // Default probes — fully-installed environment. Per-test override allowed.
  (runAllProbes as Mock).mockResolvedValue(
    happyProbes(homedir, unpackedDistPath),
  );

  // Default spawnClient: happy buildId match. (Only consulted by the REAL
  // verifyInstall in Scenario A; mocked-verify scenarios bypass it entirely.)
  (callConciergeInfo as Mock).mockResolvedValue({
    ok: true,
    data: {
      buildId: BUILD_ID,
      buildTime: BUILD_TIME,
    },
  });

  // Default verify + recover are mocked-happy (Scenario B/B' override below).
  // Scenario A overrides verify with the REAL implementation via mockImplementation.
  (verifyInstall as Mock).mockResolvedValue({ allTargetsPassed: true });
  (runRecovery as Mock).mockResolvedValue({
    recovered: true,
    reinstall: {
      desktop: { target: 'desktop', status: 'registered' },
      cli: { target: 'cli', status: 'registered' },
    },
    postVerify: { allTargetsPassed: true },
  });
});

afterEach(() => {
  restoreEnv();
  rmSync(workTmp, { recursive: true, force: true });
  rmSync(assetsDir, { recursive: true, force: true });
});

function defaultOpts(
  ui: UISink,
  extra: Partial<Parameters<typeof runOrchestrator>[0]> = {},
): Parameters<typeof runOrchestrator>[0] {
  return {
    homedir,
    unpackedDistIndexJsPath: unpackedDistPath,
    ui,
    assetsDir,
    skipUpdateCheck: true,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!INTEGRATION)('orchestrator integration (macos-14)', () => {
  it('Scenario A: happy path — probe to success in single run', async () => {
    // Use the REAL verifyInstall implementation for Scenario A — exercises
    // the cheap-check sha256 computation against the staged extension dir.
    const realVerify = await vi.importActual<
      typeof import('../../src/phases/verify.js')
    >('../../src/phases/verify.js');
    (verifyInstall as Mock).mockImplementation(realVerify.verifyInstall);

    // Stage the Desktop extension dir with bytes whose sha256 matches the
    // manifest. verifyInstall's cheap-check passes; spawnClient mock returns
    // matching buildId; outcome is plain `success`.
    stageExtensionFixture(homedir, GOOD_DIST_BYTES);

    const { sink, calls } = makeRecordingUI();
    const result = await runOrchestrator(defaultOpts(sink));

    expect(result.outcome).toBe('success');
    expect(result.exitCode).toBe(0);
    expect(result.logPath).toBeDefined();

    const methods = calls.map((c) => c.method);
    expect(methods).toContain('banner');
    expect(methods).toContain('showProbeProgress');
    expect(methods).toContain('showOauthWait');
    expect(methods).toContain('showSuccess');
    expect(methods).not.toContain('showFailure');

    // Spawn ran exactly once (shared-spawn optimization across desktop+cli).
    expect((callConciergeInfo as Mock).mock.calls.length).toBe(1);

    // Order sanity: banner before first probe; success at the end.
    const idxBanner = methods.indexOf('banner');
    const idxFirstProbe = methods.indexOf('showProbeProgress');
    const idxSuccess = methods.lastIndexOf('showSuccess');
    expect(idxBanner).toBeLessThan(idxFirstProbe);
    expect(idxSuccess).toBeGreaterThan(idxFirstProbe);
  });

  it('Scenario B: stale install triggers hard-reinstall, then succeeds', async () => {
    // Pre-stage a STALE extension dir so the on-disk state visible to
    // registerDesktop matches the "stale install" persona. registerDesktop
    // pre-emptively rms the dir + open's the .mcpb (shim no-op). Verify is
    // mocked to fail the FIRST call (cheap-check would have caught the
    // mismatch); runRecovery is mocked to succeed (1-retry budget honored).
    // Final outcome: `recovered_after_retry`.
    stageExtensionFixture(homedir, BAD_DIST_BYTES);

    (verifyInstall as Mock).mockResolvedValueOnce({
      allTargetsPassed: false,
      desktop: { target: 'desktop', pass: false, failureMode: 'sha-mismatch' },
    });
    (runRecovery as Mock).mockResolvedValueOnce({
      recovered: true,
      reinstall: {
        desktop: { target: 'desktop', status: 'registered' },
        cli: { target: 'cli', status: 'registered' },
      },
      postVerify: { allTargetsPassed: true },
    });

    const { sink, calls } = makeRecordingUI();
    const result = await runOrchestrator(defaultOpts(sink));

    expect(result.outcome).toBe('recovered_after_retry');
    expect(result.exitCode).toBe(0);

    // Recovery fired exactly once (1-retry budget contract).
    expect((runRecovery as Mock).mock.calls.length).toBe(1);
    expect((verifyInstall as Mock).mock.calls.length).toBe(1);

    // No user-visible failure — recovery succeeded.
    const failures = calls.filter((c) => c.method === 'showFailure');
    expect(failures.length).toBe(0);

    // Success message names recovery.
    const success = calls.find((c) => c.method === 'showSuccess');
    expect(String(success?.args[0])).toMatch(/Recovery/i);
  });

  it('Scenario B variant: stale + recovery still fails on second verify', async () => {
    // Same stale starting state, but recovery's postVerify also fails.
    // Orchestrator must NOT attempt a second recovery (1-retry budget).
    stageExtensionFixture(homedir, BAD_DIST_BYTES);

    (verifyInstall as Mock).mockResolvedValueOnce({
      allTargetsPassed: false,
      cli: { target: 'cli', pass: false, failureMode: 'cli-path-mismatch' },
    });
    (runRecovery as Mock).mockResolvedValueOnce({
      recovered: false,
      reinstall: {
        desktop: { target: 'desktop', status: 'registered' },
        cli: { target: 'cli', status: 'registered' },
      },
      postVerify: { allTargetsPassed: false },
    });

    const { sink, calls } = makeRecordingUI();
    const result = await runOrchestrator(defaultOpts(sink));

    expect(result.outcome).toBe('failure');
    expect(result.exitCode).toBe(3);
    expect(result.failedPhase).toBe('verify');

    // Recovery fired exactly once; no second retry attempted.
    expect((runRecovery as Mock).mock.calls.length).toBe(1);
    expect((verifyInstall as Mock).mock.calls.length).toBe(1);

    const failure = calls.find((c) => c.method === 'showFailure');
    expect(failure?.args[0]).toBe('verify');
  });

  it('Scenario A variant: probes-only warm re-run completes quickly', async () => {
    // G7 timing harness expects this: after a successful Scenario A, a
    // re-run of the probe phase alone in the same process should complete
    // in well under 3000ms. Since runAllProbes is mocked, this asserts the
    // composition fixture (not real probe perf) — it's a smoke check that
    // the orchestrator can be re-invoked in the same process without
    // lingering handles or env mutation.
    stageExtensionFixture(homedir, GOOD_DIST_BYTES);

    const ui1 = makeRecordingUI();
    const result1 = await runOrchestrator(defaultOpts(ui1.sink));
    expect(result1.outcome).toBe('success');

    // Warm re-run.
    const start = Date.now();
    const ui2 = makeRecordingUI();
    const result2 = await runOrchestrator(defaultOpts(ui2.sink));
    const elapsed = Date.now() - start;

    expect(result2.outcome).toBe('success');
    expect(elapsed).toBeLessThan(3000);
  });
});
