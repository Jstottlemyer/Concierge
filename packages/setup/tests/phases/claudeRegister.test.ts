// Tests for C5: phases/claudeRegister.ts.
//
// We exercise the real subprocess path through `child_process.execFile` —
// the SUT's whole job is correct subprocess interaction with `claude`,
// `open`, and `osascript`. We substitute each via the test shims under
// tests/fixtures/bin/, gated through the `CONCIERGE_TEST_*_BIN` env vars.
//
// State isolation per test:
//   - $CONCIERGE_TEST_CLAUDE_JSON       — temp ~/.claude.json file
//   - $CONCIERGE_TEST_OPEN_LOG          — temp file recording `open` argv
//   - $CONCIERGE_TEST_OSASCRIPT_LOG     — temp file recording `osascript` argv
//   - $CONCIERGE_TEST_CLAUDE_APP_PATHS  — colon-separated existence probes
//
// Tests NEVER touch real ~/.claude.json or real ~/Library/Application Support/Claude/.
// Each test gets a fresh tempdir homedir.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { EmbeddedManifest } from '../../src/types/manifest.js';

const execFileAsync = promisify(execFile);

// Resolve shims at repo root (packages/setup/tests/phases/ → ../../../../tests/fixtures/bin/).
const FIXTURES_BIN = resolve(__dirname, '../../../../tests/fixtures/bin');
const CLAUDE_SHIM = join(FIXTURES_BIN, 'claude');
const OPEN_SHIM = join(FIXTURES_BIN, 'open');
const OSASCRIPT_SHIM = join(FIXTURES_BIN, 'osascript');

const FIXED_SETUP_VERSION = '0.2.0';
const NAMESPACE = 'local.mcpb.justin-stottlemyer.concierge-google-workspace';

interface TestEnv {
  homedir: string;
  unpackedDistIndexJsPath: string;
  mcpbPath: string;
  claudeJsonPath: string;
  openLog: string;
  osascriptLog: string;
  manifest: EmbeddedManifest;
  /** Path inside the homedir where Claude.app should appear (for existence
   *  probe). Tests choose whether to create it or not. */
  fakeClaudeAppPath: string;
}

let savedEnv: Record<string, string | undefined> = {};
let env: TestEnv;

function snapshotEnv(): void {
  const keys = [
    'CONCIERGE_TEST_CLAUDE_JSON',
    'CONCIERGE_TEST_OPEN_LOG',
    'CONCIERGE_TEST_OSASCRIPT_LOG',
    'CONCIERGE_TEST_CLAUDE_APP_PATHS',
    'CONCIERGE_TEST_CLAUDE_BIN',
    'CONCIERGE_TEST_OPEN_BIN',
    'CONCIERGE_TEST_OSASCRIPT_BIN',
    'CONCIERGE_TEST_OPEN_EXIT_CODE',
    'CONCIERGE_TEST_OSASCRIPT_EXIT_CODE',
  ];
  savedEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
}

function restoreEnv(): void {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

function applyEnv(e: TestEnv, overrides: Partial<NodeJS.ProcessEnv> = {}): void {
  process.env['CONCIERGE_TEST_CLAUDE_JSON'] = e.claudeJsonPath;
  process.env['CONCIERGE_TEST_OPEN_LOG'] = e.openLog;
  process.env['CONCIERGE_TEST_OSASCRIPT_LOG'] = e.osascriptLog;
  process.env['CONCIERGE_TEST_CLAUDE_APP_PATHS'] = e.fakeClaudeAppPath;
  process.env['CONCIERGE_TEST_CLAUDE_BIN'] = CLAUDE_SHIM;
  process.env['CONCIERGE_TEST_OPEN_BIN'] = OPEN_SHIM;
  process.env['CONCIERGE_TEST_OSASCRIPT_BIN'] = OSASCRIPT_SHIM;
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

/** Compute sha256 hex of an in-memory string (matches the manifest format). */
function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Set up the unpacked-extension dir for the Desktop stale-install path.
 *  Returns the resulting `dist/index.js` content. */
function preCreateDesktopUnpacked(
  e: TestEnv,
  distIndexJsContent: string,
): void {
  const unpackedRoot = join(
    e.homedir,
    'Library',
    'Application Support',
    'Claude',
    'Claude Extensions',
    NAMESPACE,
  );
  mkdirSync(join(unpackedRoot, 'dist'), { recursive: true });
  writeFileSync(join(unpackedRoot, 'dist', 'index.js'), distIndexJsContent);
}

/** Read & split the open-log file into a list of invocations. Each invocation
 *  is its argv as a string array. */
function readOpenLog(path: string): string[][] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8');
  return raw
    .split('---\n')
    .filter((block) => block.length > 0)
    .map((block) => block.split('\n').filter((line) => line.length > 0));
}

beforeEach(() => {
  snapshotEnv();

  const home = mkdtempSync(join(tmpdir(), 'claude-register-test-'));
  // Build a synthetic .mcpb file (content doesn't matter for these tests —
  // we never actually unpack it; Claude Desktop is shimmed).
  const mcpbPath = join(home, 'concierge.mcpb');
  writeFileSync(mcpbPath, 'fake-mcpb-bytes');

  // Build a synthetic unpacked dist/index.js (the orchestrator-owned path
  // CLI registration writes into ~/.claude.json).
  const unpackedRoot = join(home, 'concierge-unpacked', 'dist');
  mkdirSync(unpackedRoot, { recursive: true });
  const distIndexJs = join(unpackedRoot, 'index.js');
  writeFileSync(distIndexJs, '// fake bundled orchestrator');

  // Manifest sha256 reflects the *intended-installed* dist/index.js content
  // (the value the Desktop stale-check compares against).
  const manifestSha = sha256('// installed orchestrator v0.2.0');

  const manifest: EmbeddedManifest = {
    schemaVersion: 1,
    bundledMcpb: {
      filename: 'Concierge-GoogleWorkspace-0.2.0-darwin-arm64.mcpb',
      version: '0.2.0',
      sha256: manifestSha,
      arch: 'darwin-arm64',
      namespace: NAMESPACE,
      buildId: 'test-build-id',
      buildTime: '2026-04-25T00:00:00.000Z',
      sourceCommit: '0'.repeat(40),
    },
    setupVersion: FIXED_SETUP_VERSION,
  };

  env = {
    homedir: home,
    unpackedDistIndexJsPath: distIndexJs,
    mcpbPath,
    claudeJsonPath: join(home, 'claude.json'),
    openLog: join(home, 'open.log'),
    osascriptLog: join(home, 'osascript.log'),
    manifest,
    // By default, Claude.app exists for tests — they opt out by overriding.
    fakeClaudeAppPath: join(home, 'fake-Claude.app'),
  };
  // Create the fake Claude.app marker (the SUT only stat()s the path).
  mkdirSync(env.fakeClaudeAppPath);

  applyEnv(env);
});

afterEach(() => {
  restoreEnv();
  rmSync(env.homedir, { recursive: true, force: true });
});

async function loadSut(): Promise<typeof import('../../src/phases/claudeRegister.js')> {
  return import('../../src/phases/claudeRegister.js');
}

/** Smoke-check: `jq` is present (the claude shim depends on it). Skip the
 *  CLI tests with a clear message if it's missing on the runner. */
async function jqAvailable(): Promise<boolean> {
  try {
    await execFileAsync('jq', ['--version']);
    return true;
  } catch {
    return false;
  }
}

describe('registerClaude — Desktop', () => {
  it('clean install (no unpacked dir present) → registered after open -a Claude .mcpb', async () => {
    const { registerClaude } = await loadSut();
    const res = await registerClaude({
      manifest: env.manifest,
      mcpbPath: env.mcpbPath,
      unpackedDistIndexJsPath: env.unpackedDistIndexJsPath,
      homedir: env.homedir,
    });

    expect(res.desktop.status).toBe('registered');
    const opens = readOpenLog(env.openLog);
    // Single `open -a Claude <.mcpb>` invocation.
    expect(opens).toHaveLength(1);
    expect(opens[0]).toEqual(['-a', 'Claude', env.mcpbPath]);

    // No osascript invocations on a clean install.
    expect(existsSync(env.osascriptLog)).toBe(false);
  });

  it('stale unpacked dir present (sha256 mismatch) → rm-then-open sequence runs, returns registered', async () => {
    // Pre-create unpacked dist/index.js with content whose sha256 does NOT
    // match the manifest sha (manifest expects sha256 of the v0.2.0 string).
    preCreateDesktopUnpacked(env, '// stale v0.1.0 orchestrator');

    const { registerClaude } = await loadSut();
    const res = await registerClaude({
      manifest: env.manifest,
      mcpbPath: env.mcpbPath,
      unpackedDistIndexJsPath: env.unpackedDistIndexJsPath,
      homedir: env.homedir,
    });

    expect(res.desktop.status).toBe('registered');
    expect(res.desktop.detail).toContain('Pre-emptive');

    // osascript was invoked to quit Claude.
    const osLines = readFileSync(env.osascriptLog, 'utf8');
    expect(osLines).toContain('quit app "Claude"');

    // The unpacked dir was rm'd.
    const unpackedRoot = join(
      env.homedir,
      'Library',
      'Application Support',
      'Claude',
      'Claude Extensions',
      NAMESPACE,
    );
    expect(existsSync(unpackedRoot)).toBe(false);

    // open was called once: open -a Claude <.mcpb> (we do NOT relaunch
    // separately in registerClaude — that's hardReinstallSequence's job).
    const opens = readOpenLog(env.openLog);
    expect(opens).toHaveLength(1);
    expect(opens[0]).toEqual(['-a', 'Claude', env.mcpbPath]);
  });

  it('matching sha256 already → skipped-already-registered (no open, no osascript)', async () => {
    // Pre-create unpacked dist/index.js whose sha256 matches the manifest.
    preCreateDesktopUnpacked(env, '// installed orchestrator v0.2.0');

    const { registerClaude } = await loadSut();
    const res = await registerClaude({
      manifest: env.manifest,
      mcpbPath: env.mcpbPath,
      unpackedDistIndexJsPath: env.unpackedDistIndexJsPath,
      homedir: env.homedir,
    });

    expect(res.desktop.status).toBe('skipped-already-registered');
    expect(existsSync(env.openLog)).toBe(false);
    expect(existsSync(env.osascriptLog)).toBe(false);
  });

  it('Claude.app not installed → skipped-target-missing (no open, no osascript)', async () => {
    // Override Claude.app probe to a path that doesn't exist.
    process.env['CONCIERGE_TEST_CLAUDE_APP_PATHS'] = join(
      env.homedir,
      'absent-Claude.app',
    );

    const { registerClaude } = await loadSut();
    const res = await registerClaude({
      manifest: env.manifest,
      mcpbPath: env.mcpbPath,
      unpackedDistIndexJsPath: env.unpackedDistIndexJsPath,
      homedir: env.homedir,
    });

    expect(res.desktop.status).toBe('skipped-target-missing');
    expect(existsSync(env.openLog)).toBe(false);
    expect(existsSync(env.osascriptLog)).toBe(false);
  });
});

describe('registerClaude — CLI', () => {
  it('clean → registered (claude shim writes the JSON, asserted via $CONCIERGE_TEST_CLAUDE_JSON)', async () => {
    if (!(await jqAvailable())) {
      // Skip if jq missing — the claude shim depends on it.
      return;
    }
    const { registerClaude } = await loadSut();
    const res = await registerClaude({
      manifest: env.manifest,
      mcpbPath: env.mcpbPath,
      unpackedDistIndexJsPath: env.unpackedDistIndexJsPath,
      homedir: env.homedir,
    });

    expect(res.cli.status).toBe('registered');
    // Read back the registry; assert the shape the SUT requested.
    const doc = JSON.parse(readFileSync(env.claudeJsonPath, 'utf8'));
    expect(doc.mcpServers.concierge).toEqual({
      type: 'stdio',
      command: 'node',
      args: [env.unpackedDistIndexJsPath],
      scope: 'user',
    });
  });

  it('already registered with matching path → skipped-already-registered (no shim mutation)', async () => {
    if (!(await jqAvailable())) return;
    // Pre-populate ~/.claude.json with concierge already registered at the
    // expected path. SUT should skip without calling the shim.
    writeFileSync(
      env.claudeJsonPath,
      JSON.stringify({
        mcpServers: {
          concierge: {
            type: 'stdio',
            command: 'node',
            args: [env.unpackedDistIndexJsPath],
            scope: 'user',
          },
        },
      }),
    );
    // Probe ~/.claude.json — but the SUT reads from the user's *real* homedir
    // (not via the shim's CONCIERGE_TEST_CLAUDE_JSON). For probeClaudeRegistration
    // to see the file, we must put it at homedir/.claude.json.
    const realProbeFile = join(env.homedir, '.claude.json');
    writeFileSync(
      realProbeFile,
      JSON.stringify({
        mcpServers: {
          concierge: {
            type: 'stdio',
            command: 'node',
            args: [env.unpackedDistIndexJsPath],
            scope: 'user',
          },
        },
      }),
    );

    const mtimeBefore = statSync(env.claudeJsonPath).mtimeMs;

    const { registerClaude } = await loadSut();
    const res = await registerClaude({
      manifest: env.manifest,
      mcpbPath: env.mcpbPath,
      unpackedDistIndexJsPath: env.unpackedDistIndexJsPath,
      homedir: env.homedir,
    });

    expect(res.cli.status).toBe('skipped-already-registered');
    // Shim file untouched.
    expect(statSync(env.claudeJsonPath).mtimeMs).toBe(mtimeBefore);
  });

  it('already registered with mismatched path → remove + re-add → registered', async () => {
    if (!(await jqAvailable())) return;
    const stalePath = '/old/stale/path/dist/index.js';
    // Both the probe file (homedir/.claude.json) and the shim's mutation
    // file should start with the stale entry. We point them at the same
    // file so the probe sees what the shim writes.
    const realProbeFile = join(env.homedir, '.claude.json');
    const initial = JSON.stringify({
      mcpServers: {
        concierge: {
          type: 'stdio',
          command: 'node',
          args: [stalePath],
          scope: 'user',
        },
        // Unrelated entry — must survive remove+re-add.
        foo: { type: 'stdio', command: 'other', args: [], scope: 'project' },
      },
    });
    writeFileSync(realProbeFile, initial);
    // Point the shim at the same file so its mutations are visible to the
    // probe between calls.
    process.env['CONCIERGE_TEST_CLAUDE_JSON'] = realProbeFile;
    writeFileSync(realProbeFile, initial);

    const { registerClaude } = await loadSut();
    const res = await registerClaude({
      manifest: env.manifest,
      mcpbPath: env.mcpbPath,
      unpackedDistIndexJsPath: env.unpackedDistIndexJsPath,
      homedir: env.homedir,
    });

    expect(res.cli.status).toBe('registered');
    const doc = JSON.parse(readFileSync(realProbeFile, 'utf8'));
    expect(doc.mcpServers.concierge.args).toEqual([env.unpackedDistIndexJsPath]);
    // Unrelated entry preserved.
    expect(doc.mcpServers.foo).toEqual({
      type: 'stdio',
      command: 'other',
      args: [],
      scope: 'project',
    });
  });

  it('absent ~/.claude.json AND `claude` not installed → skipped-target-missing', async () => {
    // Point CONCIERGE_TEST_CLAUDE_BIN at a path that doesn't exist so the
    // CLI presence probe (`claude --version`) fails.
    process.env['CONCIERGE_TEST_CLAUDE_BIN'] = join(
      env.homedir,
      'no-such-claude',
    );

    const { registerClaude } = await loadSut();
    const res = await registerClaude({
      manifest: env.manifest,
      mcpbPath: env.mcpbPath,
      unpackedDistIndexJsPath: env.unpackedDistIndexJsPath,
      homedir: env.homedir,
    });

    expect(res.cli.status).toBe('skipped-target-missing');
  });
});

describe('hardReinstallSequence', () => {
  it('full path runs to completion with both targets', async () => {
    if (!(await jqAvailable())) return;
    // Pre-create a stale unpacked dir to verify rm step is exercised.
    preCreateDesktopUnpacked(env, '// stale orchestrator');
    // Pre-populate registry so remove+re-add path is exercised.
    const realProbeFile = join(env.homedir, '.claude.json');
    const initial = JSON.stringify({
      mcpServers: {
        concierge: {
          type: 'stdio',
          command: 'node',
          args: ['/old/path.js'],
          scope: 'user',
        },
      },
    });
    writeFileSync(realProbeFile, initial);
    process.env['CONCIERGE_TEST_CLAUDE_JSON'] = realProbeFile;

    const { hardReinstallSequence } = await loadSut();
    const res = await hardReinstallSequence({
      manifest: env.manifest,
      mcpbPath: env.mcpbPath,
      unpackedDistIndexJsPath: env.unpackedDistIndexJsPath,
      homedir: env.homedir,
    });

    expect(res.desktop.status).toBe('registered');
    expect(res.cli.status).toBe('registered');

    // osascript quit was called once.
    const osLog = readFileSync(env.osascriptLog, 'utf8');
    expect(osLog).toContain('quit app "Claude"');

    // open was called twice: once `-a Claude` (relaunch), once `-a Claude <.mcpb>`.
    const opens = readOpenLog(env.openLog);
    expect(opens).toHaveLength(2);
    expect(opens[0]).toEqual(['-a', 'Claude']);
    expect(opens[1]).toEqual(['-a', 'Claude', env.mcpbPath]);

    // Unpacked dir is gone (rm'd in step 2; the test shim doesn't recreate it).
    const unpackedRoot = join(
      env.homedir,
      'Library',
      'Application Support',
      'Claude',
      'Claude Extensions',
      NAMESPACE,
    );
    expect(existsSync(unpackedRoot)).toBe(false);

    // CLI registry rewritten to the expected path.
    const doc = JSON.parse(readFileSync(realProbeFile, 'utf8'));
    expect(doc.mcpServers.concierge.args).toEqual([env.unpackedDistIndexJsPath]);
  });

  it('skips Desktop when Claude.app not installed but still re-registers CLI', async () => {
    if (!(await jqAvailable())) return;
    process.env['CONCIERGE_TEST_CLAUDE_APP_PATHS'] = join(
      env.homedir,
      'absent-Claude.app',
    );
    // Point the shim mutation file and the probe file at the same path so
    // the SUT can see the shim's mutations via probeClaudeRegistration.
    const realProbeFile = join(env.homedir, '.claude.json');
    process.env['CONCIERGE_TEST_CLAUDE_JSON'] = realProbeFile;

    const { hardReinstallSequence } = await loadSut();
    const res = await hardReinstallSequence({
      manifest: env.manifest,
      mcpbPath: env.mcpbPath,
      unpackedDistIndexJsPath: env.unpackedDistIndexJsPath,
      homedir: env.homedir,
    });

    expect(res.desktop.status).toBe('skipped-target-missing');
    expect(res.cli.status).toBe('registered');
    // No osascript / open invocations on the absent-Desktop path.
    expect(existsSync(env.osascriptLog)).toBe(false);
    expect(existsSync(env.openLog)).toBe(false);

    // CLI registry contains the expected entry.
    const doc = JSON.parse(readFileSync(realProbeFile, 'utf8'));
    expect(doc.mcpServers.concierge).toEqual({
      type: 'stdio',
      command: 'node',
      args: [env.unpackedDistIndexJsPath],
      scope: 'user',
    });
  });
});
