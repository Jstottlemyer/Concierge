// D1 tests: orchestrator.ts.
//
// Strategy: vi.mock every phase module so the orchestrator's composition
// logic is the only thing under test. Each test arranges a per-phase
// fixture, invokes runOrchestrator, then asserts on the returned outcome
// and the recording UISink's call log.

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';

vi.mock('../src/lock.js', () => ({
  acquireLock: vi.fn(),
}));
vi.mock('../src/log.js', () => ({
  openLogger: vi.fn(),
}));
vi.mock('../src/phases/probe.js', () => ({
  runAllProbes: vi.fn(),
}));
vi.mock('../src/phases/consent.js', () => ({
  buildConsentScreen: vi.fn(),
  captureConsent: vi.fn(),
}));
vi.mock('../src/phases/install.js', () => ({
  planInstallSteps: vi.fn(),
  runInstallSteps: vi.fn(),
}));
vi.mock('../src/phases/oauth.js', () => ({
  runGwsAuthSetup: vi.fn(),
  runGwsAuthLogin: vi.fn(),
  classifyAccountDomain: vi.fn(() => 'workspace'),
}));
vi.mock('../src/phases/claudeRegister.js', () => ({
  registerClaude: vi.fn(),
  hardReinstallSequence: vi.fn(),
}));
vi.mock('../src/phases/verify.js', () => ({
  verifyInstall: vi.fn(),
}));
vi.mock('../src/phases/recover.js', () => ({
  runRecovery: vi.fn(),
}));
vi.mock('../src/phases/updateCheck.js', () => ({
  checkForUpdate: vi.fn(),
}));
vi.mock('../src/state/manifest.js', () => ({
  readEmbeddedManifest: vi.fn(),
}));

// Imports must come AFTER vi.mock so the mocked surfaces resolve.
import { acquireLock } from '../src/lock.js';
import { openLogger } from '../src/log.js';
import { runAllProbes } from '../src/phases/probe.js';
import { buildConsentScreen, captureConsent } from '../src/phases/consent.js';
import { planInstallSteps, runInstallSteps } from '../src/phases/install.js';
import { runGwsAuthSetup, runGwsAuthLogin } from '../src/phases/oauth.js';
import { registerClaude } from '../src/phases/claudeRegister.js';
import { verifyInstall } from '../src/phases/verify.js';
import { runRecovery } from '../src/phases/recover.js';
import { checkForUpdate } from '../src/phases/updateCheck.js';
import { readEmbeddedManifest } from '../src/state/manifest.js';

import { runOrchestrator, type UISink } from '../src/orchestrator.js';
import type { EmbeddedManifest } from '../src/types/manifest.js';
import type { ProbeResult } from '../src/types/probe.js';

// ---------------------------------------------------------------------------
// Recording UI sink
// ---------------------------------------------------------------------------

interface RecordedCall {
  method: string;
  args: unknown[];
}

interface RecordingUI {
  sink: UISink;
  calls: RecordedCall[];
}

function makeRecordingUI(
  consentAccepted = true,
): RecordingUI {
  const calls: RecordedCall[] = [];
  const record = (method: string, ...args: unknown[]): void => {
    calls.push({ method, args });
  };
  const sink: UISink = {
    banner: () => record('banner'),
    showProbeProgress: (name, status) =>
      record('showProbeProgress', name, status),
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
    showLockCollision: (pid, started) =>
      record('showLockCollision', pid, started),
    showDiagnose: (text) => record('showDiagnose', text),
  };
  return { sink, calls };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_MANIFEST: EmbeddedManifest = {
  schemaVersion: 1,
  bundledMcpb: {
    filename: 'Concierge-test.mcpb',
    version: '0.1.0',
    sha256: 'a'.repeat(64),
    arch: 'darwin-arm64',
    namespace: 'local.mcpb.test.concierge-test',
    buildId: 'test-build-001',
    buildTime: '2026-04-25T00:00:00.000Z',
    sourceCommit: 'b'.repeat(40),
  },
  setupVersion: '0.0.0-test',
};

function probe(
  name: ProbeResult['name'],
  status: ProbeResult['status'],
  detail?: unknown,
): ProbeResult {
  const r: ProbeResult = {
    name,
    status,
    durationMs: 0,
    timestamp: '2026-04-25T00:00:00.000Z',
  };
  if (detail !== undefined) {
    (r as { detail?: unknown }).detail = detail;
  }
  return r;
}

const HAPPY_PROBES: readonly ProbeResult[] = [
  probe('account.domain', 'ok', { user: 'a@b.com', domain: 'b.com', type: 'workspace' }),
  probe('brew', 'ok', { version: '4.5.2' }),
  probe('claude.cli', 'ok', { version: '1.0.0', absPath: '/u/local/bin/claude' }),
  probe('claude.desktop', 'ok', { absPath: '/Applications/Claude.app', appPath: '/Applications' }),
  probe('gcloud', 'ok', { version: '470.0.0' }),
  probe('gcloud.appDefault', 'ok', { hasToken: true }),
  probe('gcp.apisEnabled', 'ok', { project: 'p1', enabled: ['gmail'], missing: [] }),
  probe('gws', 'ok', { version: '0.22.5', absPath: '/u/local/bin/gws' }),
  probe('gws.authStatus', 'ok', {
    user: 'a@b.com',
    tokenValid: true,
    projectId: 'p1',
    scopes: ['gmail'],
  }),
  probe('gws.clientSecret', 'ok', {
    path: '~/.config/gws/client_secret.json',
    projectId: 'p1',
    placeholderSuspect: false,
    clientIdNumericPrefix: '123',
  }),
  probe('gws.version', 'ok', { installed: '0.22.5', required: '0.22.5', needsUpgrade: false }),
  probe('mcpb.cli', 'ok', {
    claudeJsonPath: '~/.claude.json',
    registered: true,
    expectedAbsPath: '/tmp/x/dist/index.js',
    actualAbsPath: '/tmp/x/dist/index.js',
    matches: true,
  }),
  probe('mcpb.desktop', 'ok', {
    unpackedPath: '/tmp/x/dist/index.js',
    bundledSha: 'a'.repeat(64),
    installedSha: 'a'.repeat(64),
    namespace: 'local.mcpb.test.concierge-test',
    matches: true,
  }),
  probe('node', 'ok', { version: '20.10.0', major: 20 }),
  probe('verify.endToEnd', 'skipped'),
];

function makeFakeLogger(): {
  logger: ReturnType<typeof openLogger> extends Promise<infer L> ? L : never;
  closed: { v: boolean };
  events: Array<{ level: string; phase: string; msg: string }>;
} {
  const events: Array<{ level: string; phase: string; msg: string }> = [];
  const closed = { v: false };
  const logger = {
    info: (phase: string, msg: string) =>
      events.push({ level: 'info', phase, msg }),
    warn: (phase: string, msg: string) =>
      events.push({ level: 'warn', phase, msg }),
    error: (phase: string, msg: string) =>
      events.push({ level: 'error', phase, msg }),
    close: async () => {
      closed.v = true;
    },
    getPath: () => '/tmp/setup-fake.log',
  };
  return { logger, closed, events };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let tmpHome: string;
let releaseLock: Mock;

beforeEach(() => {
  vi.clearAllMocks();
  tmpHome = mkdtempSync(join(tmpdir(), 'concierge-orch-test-'));
  mkdirSync(join(tmpHome, '.config', 'concierge'), { recursive: true });

  releaseLock = vi.fn(async () => {});

  // Defaults — happy path. Individual tests override what they need.
  (readEmbeddedManifest as Mock).mockResolvedValue(FAKE_MANIFEST);
  (acquireLock as Mock).mockResolvedValue({
    kind: 'acquired',
    release: releaseLock,
  });
  const fake = makeFakeLogger();
  (openLogger as Mock).mockResolvedValue(fake.logger);
  (checkForUpdate as Mock).mockResolvedValue({ newer: false });
  (runAllProbes as Mock).mockResolvedValue(HAPPY_PROBES);
  (buildConsentScreen as Mock).mockReturnValue({
    detected: ['Homebrew', 'Node'],
    priorInstall: [],
    willInstall: [],
    willUpgrade: [],
    totalSizeMb: 0,
    estimatedMinutes: '1-2 min',
  });
  (captureConsent as Mock).mockResolvedValue({
    approved: true,
    autoApproved: true,
    migrations: [],
  });
  (planInstallSteps as Mock).mockReturnValue([]);
  (runInstallSteps as Mock).mockResolvedValue([]);
  (runGwsAuthSetup as Mock).mockResolvedValue({ kind: 'ok', projectId: 'p1' });
  (runGwsAuthLogin as Mock).mockResolvedValue({
    kind: 'ok',
    user: 'a@b.com',
    tokenValid: true,
    scopes: ['gmail'],
  });
  (registerClaude as Mock).mockResolvedValue({
    desktop: { target: 'desktop', status: 'registered' },
    cli: { target: 'cli', status: 'registered' },
  });
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
  rmSync(tmpHome, { recursive: true, force: true });
});

function defaultOpts(extra: Partial<Parameters<typeof runOrchestrator>[0]> = {}) {
  const ui = makeRecordingUI();
  const opts: Parameters<typeof runOrchestrator>[0] = {
    homedir: tmpHome,
    unpackedDistIndexJsPath: '/tmp/x/dist/index.js',
    ui: ui.sink,
    assetsDir: '/tmp/fake-assets',
    skipUpdateCheck: true,
    ...extra,
  };
  return { opts, ui };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runOrchestrator', () => {
  it('happy path: all phases ok → success, exit 0, full UI sequence', async () => {
    const { opts, ui } = defaultOpts();
    const result = await runOrchestrator(opts);

    expect(result.outcome).toBe('success');
    expect(result.exitCode).toBe(0);
    expect(result.logPath).toBeDefined();

    const methods = ui.calls.map((c) => c.method);
    expect(methods).toContain('banner');
    // 15 probe progress events
    const probeEvents = ui.calls.filter(
      (c) => c.method === 'showProbeProgress',
    );
    expect(probeEvents).toHaveLength(15);
    expect(methods).toContain('showOauthWait');
    expect(methods).toContain('showSuccess');
    expect(releaseLock).toHaveBeenCalled();
    // Order: banner before probe events; success at the end
    const idxBanner = methods.indexOf('banner');
    const idxFirstProbe = methods.indexOf('showProbeProgress');
    const idxSuccess = methods.lastIndexOf('showSuccess');
    expect(idxBanner).toBeLessThan(idxFirstProbe);
    expect(idxSuccess).toBeGreaterThan(idxFirstProbe);
  });

  it('lock collision → outcome=lock_collision, exit 1, only showLockCollision called', async () => {
    (acquireLock as Mock).mockResolvedValueOnce({
      kind: 'blocked',
      holder: {
        pid: 4242,
        startedAt: '2026-04-25T01:02:03.000Z',
        hostname: 'host',
        setupVersion: '0.0.0',
      },
    });

    const { opts, ui } = defaultOpts();
    const result = await runOrchestrator(opts);

    expect(result.outcome).toBe('lock_collision');
    expect(result.exitCode).toBe(1);
    const methods = ui.calls.map((c) => c.method);
    expect(methods).toEqual(['showLockCollision']);
    expect(ui.calls[0]?.args).toEqual([4242, '2026-04-25T01:02:03.000Z']);
    // No log file should have been opened.
    expect(openLogger).not.toHaveBeenCalled();
  });

  it('admin gate (pause-with-fix migration) → outcome=admin_gate, exit 2', async () => {
    (captureConsent as Mock).mockResolvedValueOnce({
      approved: false,
      autoApproved: false,
      migrations: [
        {
          ruleId: 'placeholder-project-id',
          behavior: 'pause-with-fix',
          fixHint: 'Open Cloud Console and replace project_id...',
        },
      ],
    });

    const { opts, ui } = defaultOpts();
    const result = await runOrchestrator(opts);

    expect(result.outcome).toBe('admin_gate');
    expect(result.exitCode).toBe(2);
    const adminGateCall = ui.calls.find(
      (c) => c.method === 'showAdminGate',
    );
    expect(adminGateCall).toBeDefined();
    expect(String(adminGateCall?.args[0])).toContain('Cloud Console');
    expect(releaseLock).toHaveBeenCalled();
  });

  it('consent rejected → outcome=failure, failedPhase=consent', async () => {
    (captureConsent as Mock).mockResolvedValueOnce({
      approved: false,
      autoApproved: false,
      migrations: [],
    });

    const { opts, ui } = defaultOpts();
    const result = await runOrchestrator(opts);

    expect(result.outcome).toBe('failure');
    expect(result.exitCode).toBe(3);
    expect(result.failedPhase).toBe('consent');
    const failure = ui.calls.find((c) => c.method === 'showFailure');
    expect(failure?.args[0]).toBe('consent');
    expect(releaseLock).toHaveBeenCalled();
  });

  it('install failure → outcome=failure, failedPhase=install', async () => {
    (planInstallSteps as Mock).mockReturnValueOnce([
      { tool: 'node', action: 'install', brewPackage: 'node@20', isCask: false },
    ]);
    (runInstallSteps as Mock).mockResolvedValueOnce([
      {
        tool: 'node',
        status: 'failed',
        durationMs: 100,
        stderr: 'brew install node@20 exited 1',
      },
    ]);

    const { opts, ui } = defaultOpts();
    const result = await runOrchestrator(opts);

    expect(result.outcome).toBe('failure');
    expect(result.failedPhase).toBe('install');
    const failure = ui.calls.find((c) => c.method === 'showFailure');
    expect(failure?.args[0]).toBe('install');
    expect(String(failure?.args[1])).toContain('node');
  });

  it('verify fails once, recovery succeeds → outcome=recovered_after_retry, exit 0', async () => {
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

    const { opts, ui } = defaultOpts();
    const result = await runOrchestrator(opts);

    expect(result.outcome).toBe('recovered_after_retry');
    expect(result.exitCode).toBe(0);
    expect(runRecovery).toHaveBeenCalledTimes(1);
    expect(verifyInstall).toHaveBeenCalledTimes(1);
    const success = ui.calls.find((c) => c.method === 'showSuccess');
    expect(String(success?.args[0])).toContain('Recovery');
  });

  it('verify fails, recovery fails → outcome=failure, failedPhase=verify (no second recovery)', async () => {
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

    const { opts, ui } = defaultOpts();
    const result = await runOrchestrator(opts);

    expect(result.outcome).toBe('failure');
    expect(result.failedPhase).toBe('verify');
    expect(runRecovery).toHaveBeenCalledTimes(1);
    const failure = ui.calls.find((c) => c.method === 'showFailure');
    expect(failure?.args[0]).toBe('verify');
  });

  it('OAuth port collision → showFailure with bind copy + copyable lsof command', async () => {
    (runGwsAuthLogin as Mock).mockResolvedValueOnce({
      kind: 'port_collision',
      port: 8080,
      rawStderrLine: 'bind: address already in use (port 8080)',
    });

    const { opts, ui } = defaultOpts();
    const result = await runOrchestrator(opts);

    expect(result.outcome).toBe('failure');
    expect(result.failedPhase).toBe('oauth.login');
    const failure = ui.calls.find((c) => c.method === 'showFailure');
    expect(failure?.args[0]).toBe('oauth.login');
    expect(String(failure?.args[1])).toContain('8080');
    expect(failure?.args[2]).toBe('lsof -i :8080');
  });

  it('registers a process exit handler after openLogger succeeds', async () => {
    const onSpy = vi.spyOn(process, 'on');

    const { opts } = defaultOpts();
    await runOrchestrator(opts);

    const calls = onSpy.mock.calls.map((c) => c[0]);
    expect(calls).toContain('exit');
    expect(calls).toContain('SIGINT');
    onSpy.mockRestore();
  });

  it('releases the lock on success, on failure, and on admin_gate', async () => {
    // Success
    {
      const { opts } = defaultOpts();
      await runOrchestrator(opts);
      expect(releaseLock).toHaveBeenCalled();
    }
    // Failure (consent rejected)
    {
      releaseLock.mockClear();
      (captureConsent as Mock).mockResolvedValueOnce({
        approved: false,
        autoApproved: false,
        migrations: [],
      });
      const { opts } = defaultOpts();
      await runOrchestrator(opts);
      expect(releaseLock).toHaveBeenCalled();
    }
    // Admin gate
    {
      releaseLock.mockClear();
      (captureConsent as Mock).mockResolvedValueOnce({
        approved: false,
        autoApproved: false,
        migrations: [
          {
            ruleId: 'placeholder-project-id',
            behavior: 'pause-with-fix',
            fixHint: 'fix it',
          },
        ],
      });
      const { opts } = defaultOpts();
      await runOrchestrator(opts);
      expect(releaseLock).toHaveBeenCalled();
    }
  });

  it('reads the embedded manifest from assetsDir/manifest.json', async () => {
    const { opts } = defaultOpts({ assetsDir: '/some/assets/dir' });
    await runOrchestrator(opts);
    expect(readEmbeddedManifest).toHaveBeenCalledWith(
      '/some/assets/dir/manifest.json',
    );
  });

  it('skips the gws auth setup phase when client_secret is already present', async () => {
    // HAPPY_PROBES has client_secret status=ok; so setup should NOT run.
    const { opts } = defaultOpts();
    await runOrchestrator(opts);
    expect(runGwsAuthSetup).not.toHaveBeenCalled();
  });

  it('runs gws auth setup when client_secret is missing', async () => {
    const probesWithMissingCS = HAPPY_PROBES.map((p) =>
      p.name === 'gws.clientSecret'
        ? { ...p, status: 'missing' as const, detail: undefined }
        : p,
    );
    (runAllProbes as Mock).mockResolvedValueOnce(probesWithMissingCS);

    const { opts } = defaultOpts();
    await runOrchestrator(opts);
    expect(runGwsAuthSetup).toHaveBeenCalledTimes(1);
  });

  it('manifest read failure → outcome=failure, no lock acquired', async () => {
    (readEmbeddedManifest as Mock).mockRejectedValueOnce(
      new Error('missing manifest'),
    );

    const { opts, ui } = defaultOpts();
    const result = await runOrchestrator(opts);

    expect(result.outcome).toBe('failure');
    expect(result.failedPhase).toBe('manifest');
    expect(acquireLock).not.toHaveBeenCalled();
    const failure = ui.calls.find((c) => c.method === 'showFailure');
    expect(failure?.args[0]).toBe('manifest');
  });
});

// Reference the writeFileSync import so it isn't pruned by ts-eslint when
// future tests need a real assets dir on disk.
void writeFileSync;
