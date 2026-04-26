// C1 tests: phases/probe.ts.
//
// The probe orchestrator's whole job is correct subprocess + filesystem
// observation, so mocking child_process at the module boundary would defeat
// the point. Instead we drive real subprocess spawns through:
//   - the F2b `gws` shim (CONCIERGE_TEST_GWS_BIN absolute path)
//   - the F2a `claude` shim (placed first on PATH via per-test PATH override)
//   - real `brew` / `node` / `gcloud` if present (otherwise the probe
//     correctly returns `missing` — that's the test).
//
// Each test isolates state via per-test tempdirs:
//   - `homedir` — synthetic ~ for the probe context
//   - CONCIERGE_TEST_GWS_DIR — per-test gws fixture state
//   - PATH manipulation — point `claude` at the shim, optionally hide other bins
//
// We do NOT exercise the real ~/.config/gws or real ~/.claude.json. Every
// test snapshots+restores process.env so it can't bleed.

import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { EmbeddedManifest } from '../../src/types/manifest.js';
import type {
  AccountDomainDetail,
  AuthStatusDetail,
  BrewDetail,
  ClaudeDesktopDetail,
  ClientSecretDetail,
  GwsDetail,
  GwsVersionDetail,
  McpbCliDetail,
  McpbDesktopDetail,
  NodeDetail,
  ProbeName,
  ProbeResult,
} from '../../src/types/probe.js';

import { runAllProbes, type ProbeContext } from '../../src/phases/probe.js';

// Tests spawn real subprocesses (brew/node/gcloud/gws shim/claude shim);
// the `gcloud auth application-default print-access-token` probe in
// particular can take 3+ seconds when no network is available (it retries
// the GCE metadata server). Bump the per-test timeout above the vitest
// 5s default so we don't trip over honest probe latency.
const TEST_TIMEOUT_MS = 30_000;

// Fixtures live at repo-root tests/fixtures/bin/.
// packages/setup/tests/phases/ → ../../../../tests/fixtures/bin
const FIXTURE_BIN_DIR = resolve(__dirname, '../../../../tests/fixtures/bin');
const GWS_SHIM = join(FIXTURE_BIN_DIR, 'gws');
const CLAUDE_SHIM = join(FIXTURE_BIN_DIR, 'claude');

let tmp: string;
let homedir: string;
let gwsDir: string;
let savedEnv: Record<string, string | undefined> = {};

const ENV_KEYS = [
  'CONCIERGE_TEST_GWS_BIN',
  'CONCIERGE_TEST_GWS_DIR',
  'CONCIERGE_TEST_GWS_USER',
  'CONCIERGE_TEST_GWS_PORT_COLLISION',
  'PATH',
];

function snapshotEnv(): void {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
}

function restoreEnv(): void {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'concierge-probe-test-'));
  homedir = join(tmp, 'home');
  gwsDir = join(tmp, 'gws');
  mkdirSync(homedir, { recursive: true });
  mkdirSync(gwsDir, { recursive: true });
  snapshotEnv();
  // Default: route gws to the shim, isolate gws state to per-test tempdir.
  process.env['CONCIERGE_TEST_GWS_BIN'] = GWS_SHIM;
  process.env['CONCIERGE_TEST_GWS_DIR'] = gwsDir;
  // Put fixtures dir first so `claude` resolves to the shim.
  process.env['PATH'] = `${FIXTURE_BIN_DIR}:${process.env['PATH'] ?? ''}`;
});

afterEach(() => {
  restoreEnv();
  rmSync(tmp, { recursive: true, force: true });
});

// --- helpers ---------------------------------------------------------------

const VALID_MANIFEST: EmbeddedManifest = {
  schemaVersion: 1,
  bundledMcpb: {
    filename: 'Concierge-GoogleWorkspace-0.2.0-darwin-arm64.mcpb',
    version: '0.2.0',
    sha256: 'a'.repeat(64),
    arch: 'darwin-arm64',
    namespace: 'local.mcpb.justin-stottlemyer.concierge-google-workspace',
    buildId: 'build-12345',
    buildTime: '2026-04-16T12:00:00Z',
    sourceCommit: 'b'.repeat(40),
  },
  setupVersion: '2.0.0',
};

function findProbe<T = unknown>(
  results: readonly ProbeResult[],
  name: ProbeName,
): ProbeResult<T> {
  const r = results.find((p) => p.name === name);
  if (r === undefined) throw new Error(`probe ${name} not in results`);
  return r as ProbeResult<T>;
}

/** Hide known binaries (brew/node/gcloud/etc.) by pointing PATH at an empty
 *  dir. Useful for "everything missing" tests. The gws shim still needs to
 *  resolve, so we keep the fixtures dir on PATH and route gws via env. */
function isolatePath(): void {
  const empty = join(tmp, 'empty-path');
  mkdirSync(empty, { recursive: true });
  // Keep fixtures dir + /usr/bin + /bin so:
  //   - claude shim resolves to the test binary
  //   - the shim's `#!/usr/bin/env bash` can find env + bash
  //   - the probe orchestrator can still spawn /bin/sh for `command -v` lookups
  // We drop /usr/local/bin + /opt/homebrew/bin so brew/node/gcloud become
  // invisible — those are the binaries we want to assert as `missing`.
  process.env['PATH'] = `${empty}:${FIXTURE_BIN_DIR}:/usr/bin:/bin`;
}

async function authenticateGws(user = 'test@example.com'): Promise<void> {
  // Run shim to populate auth-status.json + client_secret.json.
  execFileSync(GWS_SHIM, ['auth', 'setup'], {
    env: { ...process.env, CONCIERGE_TEST_GWS_DIR: gwsDir },
    stdio: 'pipe',
  });
  execFileSync(GWS_SHIM, ['auth', 'login', '--services', 'drive,gmail'], {
    env: {
      ...process.env,
      CONCIERGE_TEST_GWS_DIR: gwsDir,
      CONCIERGE_TEST_GWS_USER: user,
    },
    stdio: 'pipe',
  });
}

// ---------------------------------------------------------------------------

describe('runAllProbes', () => {
  it('returns all 15 probes sorted by name', async () => {
    const ctx: ProbeContext = { homedir };
    const results = await runAllProbes(ctx);
    expect(results.length).toBe(15);
    const names = results.map((r) => r.name);
    expect(names).toEqual([
      'account.domain',
      'brew',
      'claude.cli',
      'claude.desktop',
      'gcloud',
      'gcloud.appDefault',
      'gcp.apisEnabled',
      'gws',
      'gws.authStatus',
      'gws.clientSecret',
      'gws.version',
      'mcpb.cli',
      'mcpb.desktop',
      'node',
      'verify.endToEnd',
    ]);
    // Every result has timing + iso timestamp.
    for (const r of results) {
      expect(typeof r.durationMs).toBe('number');
      expect(r.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
    // verify.endToEnd is a placeholder (C6 owns it).
    expect(findProbe(results, 'verify.endToEnd').status).toBe('skipped');
  }, TEST_TIMEOUT_MS);

  it('happy path with shimmed gws + authenticated state populates expected probes', async () => {
    await authenticateGws('ceo@pashion.example');
    const ctx: ProbeContext = { homedir };
    const results = await runAllProbes(ctx);

    const gws = findProbe<GwsDetail>(results, 'gws');
    expect(gws.status).toBe('ok');
    expect(gws.detail?.version).toBe('0.22.5');
    expect(gws.detail?.absPath).toBe(GWS_SHIM);

    const gwsVer = findProbe<GwsVersionDetail>(results, 'gws.version');
    expect(gwsVer.status).toBe('ok');
    expect(gwsVer.detail).toEqual({
      installed: '0.22.5',
      required: '0.22.5',
      needsUpgrade: false,
    });

    const cs = findProbe<ClientSecretDetail>(results, 'gws.clientSecret');
    expect(cs.status).toBe('ok');
    expect(cs.detail?.projectId).toBe('concierge-test-shim');
    expect(cs.detail?.clientIdNumericPrefix).toBe('493302');
    // 'concierge-test-shim' does NOT match the strict placeholder regex
    // (the regex anchors to `^(authtools|concierge)-(?:spike|test|...)$` —
    // the trailing `-shim` puts it outside the placeholder family). The
    // `placeholder project_id detection` test below exercises the true case.
    expect(cs.detail?.placeholderSuspect).toBe(false);

    const auth = findProbe<AuthStatusDetail>(results, 'gws.authStatus');
    expect(auth.status).toBe('ok');
    expect(auth.detail?.user).toBe('ceo@pashion.example');
    expect(auth.detail?.tokenValid).toBe(true);

    const dom = findProbe<AccountDomainDetail>(results, 'account.domain');
    expect(dom.status).toBe('ok');
    expect(dom.detail).toEqual({
      user: 'ceo@pashion.example',
      domain: 'pashion.example',
      type: 'workspace',
    });

    // Claude CLI shim is on PATH → reports ok.
    expect(findProbe(results, 'claude.cli').status).toBe('ok');
  }, TEST_TIMEOUT_MS);

  it('classifies a personal Gmail account as personal', async () => {
    await authenticateGws('user@gmail.com');
    const ctx: ProbeContext = { homedir };
    const results = await runAllProbes(ctx);
    const dom = findProbe<AccountDomainDetail>(results, 'account.domain');
    expect(dom.status).toBe('ok');
    expect(dom.detail?.type).toBe('personal');
    expect(dom.detail?.domain).toBe('gmail.com');
  }, TEST_TIMEOUT_MS);

  it('account.domain is skipped when gws.authStatus is missing', async () => {
    // Don't run authenticateGws → shim returns exit 2 / "no credentials"
    const ctx: ProbeContext = { homedir };
    const results = await runAllProbes(ctx);
    const auth = findProbe<AuthStatusDetail>(results, 'gws.authStatus');
    expect(auth.status).toBe('missing');
    const dom = findProbe<AccountDomainDetail>(results, 'account.domain');
    expect(dom.status).toBe('skipped');
    expect(dom.detail).toBeUndefined();
  }, TEST_TIMEOUT_MS);

  it('reports brew/node/gcloud as missing when not on PATH', async () => {
    isolatePath();
    const ctx: ProbeContext = { homedir };
    const results = await runAllProbes(ctx);
    expect(findProbe(results, 'brew').status).toBe('missing');
    expect(findProbe(results, 'node').status).toBe('missing');
    expect(findProbe(results, 'gcloud').status).toBe('missing');
    expect(findProbe(results, 'gcloud.appDefault').status).toBe('missing');
    // claude.cli still resolves via fixtures dir on PATH.
    expect(findProbe(results, 'claude.cli').status).toBe('ok');
    // gws still routes via env-injected shim, independent of PATH.
    expect(findProbe(results, 'gws').status).toBe('ok');
  }, TEST_TIMEOUT_MS);

  it('gws.clientSecret reports missing when no file written yet', async () => {
    // No authenticateGws — gwsDir is empty.
    const ctx: ProbeContext = { homedir };
    const results = await runAllProbes(ctx);
    expect(findProbe(results, 'gws.clientSecret').status).toBe('missing');
  }, TEST_TIMEOUT_MS);

  it('placeholder project_id detection sets placeholderSuspect: true', async () => {
    // Hand-write a client_secret.json with the canonical placeholder
    // (CLAUDE.md known-bad pattern: authtools-spike).
    writeFileSync(
      join(gwsDir, 'client_secret.json'),
      JSON.stringify({
        installed: {
          project_id: 'authtools-spike',
          client_id: '999111-abc.apps.googleusercontent.com',
        },
      }),
    );
    const ctx: ProbeContext = { homedir };
    const results = await runAllProbes(ctx);
    const cs = findProbe<ClientSecretDetail>(results, 'gws.clientSecret');
    expect(cs.status).toBe('ok');
    expect(cs.detail?.projectId).toBe('authtools-spike');
    expect(cs.detail?.placeholderSuspect).toBe(true);
    expect(cs.detail?.clientIdNumericPrefix).toBe('999111');
  }, TEST_TIMEOUT_MS);

  it('non-placeholder real project_id returns placeholderSuspect: false', async () => {
    writeFileSync(
      join(gwsDir, 'client_secret.json'),
      JSON.stringify({
        installed: {
          project_id: 'pashion-prod-493302',
          client_id: '493302-abc.apps.googleusercontent.com',
        },
      }),
    );
    const ctx: ProbeContext = { homedir };
    const results = await runAllProbes(ctx);
    const cs = findProbe<ClientSecretDetail>(results, 'gws.clientSecret');
    expect(cs.status).toBe('ok');
    expect(cs.detail?.projectId).toBe('pashion-prod-493302');
    expect(cs.detail?.placeholderSuspect).toBe(false);
  }, TEST_TIMEOUT_MS);

  it('claude.desktop returns missing when neither /Applications nor ~/Applications has Claude.app', async () => {
    // homedir is per-test tempdir → ~/Applications/Claude.app definitely absent.
    // /Applications/Claude.app may exist on dev machines; tolerate both.
    const ctx: ProbeContext = { homedir };
    const results = await runAllProbes(ctx);
    const desk = findProbe<ClaudeDesktopDetail>(results, 'claude.desktop');
    if (desk.status === 'ok') {
      // Real Claude installed on this machine — shape sanity check.
      expect(desk.detail?.absPath).toBe('/Applications/Claude.app');
      expect(desk.detail?.appPath).toBe('/Applications');
    } else {
      expect(desk.status).toBe('missing');
      expect(desk.detail).toBeUndefined();
    }
  }, TEST_TIMEOUT_MS);

  it('claude.desktop probe finds ~/Applications/Claude.app when present', async () => {
    // Synthesize a fake Claude.app dir under our synthetic homedir.
    const userApp = join(homedir, 'Applications', 'Claude.app');
    mkdirSync(userApp, { recursive: true });
    const ctx: ProbeContext = { homedir };
    const results = await runAllProbes(ctx);
    const desk = findProbe<ClaudeDesktopDetail>(results, 'claude.desktop');
    // If /Applications/Claude.app also exists on this machine, the probe
    // returns it (checked first); otherwise the user-local one wins.
    expect(desk.status).toBe('ok');
    if (desk.detail?.appPath === '~/Applications') {
      expect(desk.detail?.absPath).toBe(userApp);
    } else {
      expect(desk.detail?.appPath).toBe('/Applications');
      expect(desk.detail?.absPath).toBe('/Applications/Claude.app');
    }
  }, TEST_TIMEOUT_MS);

  it('mcpb.desktop is skipped when ctx.unpackedDistIndexJsPath / manifest not provided', async () => {
    const ctx: ProbeContext = { homedir };
    const results = await runAllProbes(ctx);
    expect(findProbe(results, 'mcpb.desktop').status).toBe('skipped');
    expect(findProbe(results, 'mcpb.cli').status).toBe('skipped');
  }, TEST_TIMEOUT_MS);

  it('mcpb.desktop reports ok when sha256 matches manifest, stale when it does not', async () => {
    // Synthesize an unpacked dist/index.js with known content + matching sha.
    const distDir = join(tmp, 'unpacked', 'dist');
    mkdirSync(distDir, { recursive: true });
    const distJs = join(distDir, 'index.js');
    const content = 'console.log("hello concierge");\n';
    writeFileSync(distJs, content);

    // Compute the real sha for this content.
    const { createHash } = await import('node:crypto');
    const realSha = createHash('sha256').update(content).digest('hex');

    // ok branch: manifest sha matches.
    const okManifest: EmbeddedManifest = {
      ...VALID_MANIFEST,
      bundledMcpb: { ...VALID_MANIFEST.bundledMcpb, sha256: realSha },
    };
    const ctxOk: ProbeContext = {
      homedir,
      unpackedDistIndexJsPath: distJs,
      manifest: okManifest,
    };
    const okResults = await runAllProbes(ctxOk);
    const okMcpb = findProbe<McpbDesktopDetail>(okResults, 'mcpb.desktop');
    expect(okMcpb.status).toBe('ok');
    expect(okMcpb.detail?.matches).toBe(true);
    expect(okMcpb.detail?.installedSha).toBe(realSha);
    expect(okMcpb.detail?.bundledSha).toBe(realSha);

    // stale branch: manifest sha does not match.
    const staleManifest: EmbeddedManifest = {
      ...VALID_MANIFEST,
      bundledMcpb: { ...VALID_MANIFEST.bundledMcpb, sha256: 'c'.repeat(64) },
    };
    const ctxStale: ProbeContext = {
      homedir,
      unpackedDistIndexJsPath: distJs,
      manifest: staleManifest,
    };
    const staleResults = await runAllProbes(ctxStale);
    const staleMcpb = findProbe<McpbDesktopDetail>(
      staleResults,
      'mcpb.desktop',
    );
    expect(staleMcpb.status).toBe('stale');
    expect(staleMcpb.detail?.matches).toBe(false);
  }, TEST_TIMEOUT_MS);

  it('mcpb.cli reports missing when ~/.claude.json absent and ok when registered with matching path', async () => {
    const expectedPath = '/abs/path/dist/index.js';

    // Missing branch: no ~/.claude.json file.
    const ctxMissing: ProbeContext = {
      homedir,
      claudeCliExpectedPath: expectedPath,
    };
    const missing = await runAllProbes(ctxMissing);
    const missingMcpb = findProbe<McpbCliDetail>(missing, 'mcpb.cli');
    expect(missingMcpb.status).toBe('missing');
    expect(missingMcpb.detail?.registered).toBe(false);
    expect(missingMcpb.detail?.matches).toBe(false);

    // Registered + matching branch.
    writeFileSync(
      join(homedir, '.claude.json'),
      JSON.stringify({
        mcpServers: {
          concierge: {
            type: 'stdio',
            command: 'node',
            args: [expectedPath],
            scope: 'user',
          },
        },
      }),
    );
    const okResults = await runAllProbes(ctxMissing);
    const okMcpb = findProbe<McpbCliDetail>(okResults, 'mcpb.cli');
    expect(okMcpb.status).toBe('ok');
    expect(okMcpb.detail?.registered).toBe(true);
    expect(okMcpb.detail?.matches).toBe(true);
    expect(okMcpb.detail?.actualAbsPath).toBe(expectedPath);

    // Registered but mismatched path → stale.
    writeFileSync(
      join(homedir, '.claude.json'),
      JSON.stringify({
        mcpServers: {
          concierge: {
            type: 'stdio',
            command: 'node',
            args: ['/different/path.js'],
            scope: 'user',
          },
        },
      }),
    );
    const staleResults = await runAllProbes(ctxMissing);
    const staleMcpb = findProbe<McpbCliDetail>(staleResults, 'mcpb.cli');
    expect(staleMcpb.status).toBe('stale');
    expect(staleMcpb.detail?.registered).toBe(true);
    expect(staleMcpb.detail?.matches).toBe(false);
  }, TEST_TIMEOUT_MS);

  it('runs probes in parallel — total wall-time < sum of individual probe times (best-effort)', async () => {
    await authenticateGws();
    const ctx: ProbeContext = { homedir };
    const wallStart = Date.now();
    const results = await runAllProbes(ctx);
    const wallMs = Date.now() - wallStart;
    const summed = results.reduce((acc, r) => acc + r.durationMs, 0);
    // Best-effort assertion: parallel orchestration should be faster than
    // running every probe back-to-back. We give plenty of slack to avoid
    // flakes on slow CI runners — the point is to catch a regression to
    // serial execution, not to assert a tight bound.
    expect(wallMs).toBeLessThan(summed * 1.5);
  }, TEST_TIMEOUT_MS);

  it('brew/node detail shape is the expected NodeDetail / BrewDetail when present', async () => {
    // Don't isolate PATH — let real brew/node show through if installed.
    const ctx: ProbeContext = { homedir };
    const results = await runAllProbes(ctx);
    const brew = findProbe<BrewDetail>(results, 'brew');
    if (brew.status === 'ok') {
      expect(typeof brew.detail?.version).toBe('string');
      expect((brew.detail?.version ?? '').length).toBeGreaterThan(0);
    } else {
      expect(brew.status).toBe('missing');
    }
    const node = findProbe<NodeDetail>(results, 'node');
    if (node.status === 'ok') {
      expect(typeof node.detail?.version).toBe('string');
      expect(node.detail?.major).toBeGreaterThan(0);
    } else {
      expect(node.status).toBe('missing');
    }
  }, TEST_TIMEOUT_MS);

  it('composite gws probe surfaces stale gws.version when installed < required', async () => {
    // Build a one-off shim that emits an old version string, swap it in via
    // CONCIERGE_TEST_GWS_BIN, and confirm gws.version flips to stale.
    const oldShim = join(tmp, 'gws-old');
    writeFileSync(
      oldShim,
      '#!/usr/bin/env bash\nset -u\nif [[ "${1:-}" = "--version" ]]; then echo "gws 0.10.0"; exit 0; fi\n' +
        'if [[ "${1:-}" = "auth" && "${2:-}" = "status" ]]; then echo "no credentials" >&2; exit 2; fi\n' +
        'echo "unknown" >&2; exit 1\n',
    );
    execFileSync('chmod', ['+x', oldShim]);
    process.env['CONCIERGE_TEST_GWS_BIN'] = oldShim;

    const ctx: ProbeContext = { homedir };
    const results = await runAllProbes(ctx);
    const gws = findProbe<GwsDetail>(results, 'gws');
    expect(gws.status).toBe('ok');
    expect(gws.detail?.version).toBe('0.10.0');

    const gwsVer = findProbe<GwsVersionDetail>(results, 'gws.version');
    expect(gwsVer.status).toBe('stale');
    expect(gwsVer.detail).toEqual({
      installed: '0.10.0',
      required: '0.22.5',
      needsUpgrade: true,
    });
  }, TEST_TIMEOUT_MS);
});
