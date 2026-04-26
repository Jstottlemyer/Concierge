// E3a tests: exercise packages/setup/build/prepare-assets.sh end-to-end
// against a synthetic fixture .mcpb. The fixture is a real zip (per .mcpb
// format) containing a minimal `manifest.json` + a `dist/index.js` stub
// shaped like tsup's output (so the readBuildTime/readBuildId regexes hit).
//
// Each test runs the script with CONCIERGE_MCPB_DIR pointing at a tempdir,
// then asserts on the produced packages/setup/assets/{manifest.json, .mcpb}.
// We also re-validate the produced manifest against B2's real
// readEmbeddedManifest to detect drift between the inline JS validator in
// the script and the canonical TS rules.
//
// Bash-script invocation: child_process.execFileSync. Errors throw with
// stdout+stderr on the Error object so failures are debuggable.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readEmbeddedManifest } from '../../src/state/manifest.js';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const SCRIPT = join(REPO_ROOT, 'packages', 'setup', 'build', 'prepare-assets.sh');
const ASSETS_DIR = join(REPO_ROOT, 'packages', 'setup', 'assets');

// --- Fixture helpers --------------------------------------------------------

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `concierge-e3a-${prefix}-`));
}

interface BuildFixtureOpts {
  filename: string;
  /** Inner manifest.json contents (object). Pass null to skip writing it. */
  innerManifest: Record<string, unknown> | null;
  /** dist/index.js body. Pass null to skip writing it. */
  distIndexBody: string | null;
  /** Bytes of an extra junk file when both above are null (used to make a malformed .mcpb that still extracts). */
  junkFile?: { name: string; body: string };
}

/**
 * Build a .mcpb (zip) fixture. Returns the absolute path. Uses the system
 * `zip` binary (always present on macOS dev environments + GitHub runners).
 */
function buildFixtureMcpb(intoDir: string, opts: BuildFixtureOpts): string {
  const stage = mkdtempSync(join(tmpdir(), 'concierge-e3a-stage-'));
  if (opts.innerManifest !== null) {
    writeFileSync(join(stage, 'manifest.json'), JSON.stringify(opts.innerManifest, null, 2));
  }
  if (opts.distIndexBody !== null) {
    mkdirSync(join(stage, 'dist'), { recursive: true });
    writeFileSync(join(stage, 'dist', 'index.js'), opts.distIndexBody);
  }
  if (opts.junkFile) {
    writeFileSync(join(stage, opts.junkFile.name), opts.junkFile.body);
  }
  const outPath = join(intoDir, opts.filename);
  execFileSync('zip', ['-qr', outPath, '.'], { cwd: stage });
  rmSync(stage, { recursive: true, force: true });
  return outPath;
}

/** tsup-shaped readBuildTime / readBuildId function bodies. */
function distStub(buildTime: string, buildId: string): string {
  return `
function readBuildTime() {
  if (true) {
    return "${buildTime}";
  }
  return "dev-unbuilt";
}
function readBuildId() {
  if (true) {
    return "${buildId}";
  }
  return "devbuild";
}
// ... rest of bundle elided ...
`;
}

function innerManifest(version: string): Record<string, unknown> {
  return {
    manifest_version: '0.3',
    name: 'concierge-google-workspace',
    display_name: 'Concierge — Google Workspace',
    version,
    author: { name: 'Justin Stottlemyer' },
  };
}

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runScript(env: Record<string, string>): RunResult {
  try {
    const stdout = execFileSync(SCRIPT, [], {
      env: { ...process.env, ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      status: e.status ?? 1,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
    };
  }
}

// --- Asset preservation -----------------------------------------------------
// Stash whatever's already in packages/setup/assets/ so the test doesn't
// clobber a developer's local pre-prepared assets. Restore after each test.

let stashedAssets: { name: string; bytes: Buffer }[] = [];

beforeEach(() => {
  stashedAssets = [];
  if (existsSync(ASSETS_DIR)) {
    for (const f of execFileSync('ls', [ASSETS_DIR], { encoding: 'utf8' }).split('\n').filter(Boolean)) {
      stashedAssets.push({ name: f, bytes: readFileSync(join(ASSETS_DIR, f)) });
      rmSync(join(ASSETS_DIR, f));
    }
  } else {
    mkdirSync(ASSETS_DIR, { recursive: true });
  }
});

afterEach(() => {
  if (existsSync(ASSETS_DIR)) {
    for (const f of execFileSync('ls', [ASSETS_DIR], { encoding: 'utf8' }).split('\n').filter(Boolean)) {
      rmSync(join(ASSETS_DIR, f));
    }
  }
  for (const { name, bytes } of stashedAssets) {
    writeFileSync(join(ASSETS_DIR, name), bytes);
  }
});

// --- Tests ------------------------------------------------------------------

describe('prepare-assets.sh', () => {
  it('produces a valid manifest.json + copies .mcpb on the happy path', () => {
    const dir = tempDir('happy');
    buildFixtureMcpb(dir, {
      filename: 'Concierge-GoogleWorkspace-9.9.9-fixture-darwin-arm64.mcpb',
      innerManifest: innerManifest('9.9.9-fixture'),
      distIndexBody: distStub('2026-04-25T12:00:00.000Z', 'abc12345'),
    });

    const result = runScript({ CONCIERGE_MCPB_DIR: dir });

    expect(result.status, `script failed:\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`).toBe(0);
    expect(result.stdout).toContain('SUCCESS');

    const manifestPath = join(ASSETS_DIR, 'manifest.json');
    expect(existsSync(manifestPath)).toBe(true);
    expect(existsSync(join(ASSETS_DIR, 'Concierge-GoogleWorkspace-9.9.9-fixture-darwin-arm64.mcpb'))).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });

  it('produces a manifest that passes B2 readEmbeddedManifest (drift gate)', async () => {
    const dir = tempDir('b2-drift');
    buildFixtureMcpb(dir, {
      filename: 'Concierge-GoogleWorkspace-1.2.3-darwin-arm64.mcpb',
      innerManifest: innerManifest('1.2.3'),
      distIndexBody: distStub('2026-04-25T13:14:15.000Z', 'deadbeef'),
    });

    const result = runScript({ CONCIERGE_MCPB_DIR: dir });
    expect(result.status, `script failed:\nSTDERR: ${result.stderr}`).toBe(0);

    // Re-validate against the canonical B2 SUT to catch drift between the
    // inline JS validator in prepare-assets.sh and src/state/manifest.ts.
    const parsed = await readEmbeddedManifest(join(ASSETS_DIR, 'manifest.json'));
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.bundledMcpb.filename).toBe('Concierge-GoogleWorkspace-1.2.3-darwin-arm64.mcpb');
    expect(parsed.bundledMcpb.version).toBe('1.2.3');
    expect(parsed.bundledMcpb.arch).toBe('darwin-arm64');
    expect(parsed.bundledMcpb.namespace).toBe(
      'local.mcpb.justin-stottlemyer.concierge-google-workspace',
    );
    expect(parsed.bundledMcpb.buildId).toBe('deadbeef');
    expect(parsed.bundledMcpb.buildTime).toBe('2026-04-25T13:14:15.000Z');
    expect(parsed.bundledMcpb.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(parsed.bundledMcpb.sourceCommit).toMatch(/^[a-f0-9]{40}$/);

    rmSync(dir, { recursive: true, force: true });
  });

  it('is idempotent: a second run produces a byte-identical manifest', () => {
    const dir = tempDir('idempotent');
    buildFixtureMcpb(dir, {
      filename: 'Concierge-GoogleWorkspace-2.0.0-darwin-arm64.mcpb',
      innerManifest: innerManifest('2.0.0'),
      distIndexBody: distStub('2026-04-25T14:00:00.000Z', '01234567'),
    });

    const r1 = runScript({ CONCIERGE_MCPB_DIR: dir });
    expect(r1.status).toBe(0);
    const first = readFileSync(join(ASSETS_DIR, 'manifest.json'), 'utf8');

    const r2 = runScript({ CONCIERGE_MCPB_DIR: dir });
    expect(r2.status).toBe(0);
    const second = readFileSync(join(ASSETS_DIR, 'manifest.json'), 'utf8');

    expect(second).toBe(first);
    rmSync(dir, { recursive: true, force: true });
  });

  it('exits non-zero with helpful error when no .mcpb is found', () => {
    const dir = tempDir('empty');
    const result = runScript({ CONCIERGE_MCPB_DIR: dir });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/no Concierge-GoogleWorkspace-.*\.mcpb found/);
    rmSync(dir, { recursive: true, force: true });
  });

  it('exits non-zero when multiple .mcpb files match the glob', () => {
    const dir = tempDir('multi');
    buildFixtureMcpb(dir, {
      filename: 'Concierge-GoogleWorkspace-1.0.0-darwin-arm64.mcpb',
      innerManifest: innerManifest('1.0.0'),
      distIndexBody: distStub('2026-04-25T14:00:00.000Z', 'aaaaaaaa'),
    });
    buildFixtureMcpb(dir, {
      filename: 'Concierge-GoogleWorkspace-2.0.0-darwin-arm64.mcpb',
      innerManifest: innerManifest('2.0.0'),
      distIndexBody: distStub('2026-04-25T14:00:00.000Z', 'bbbbbbbb'),
    });

    const result = runScript({ CONCIERGE_MCPB_DIR: dir });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/multiple .mcpb files found/);
    rmSync(dir, { recursive: true, force: true });
  });

  it('exits non-zero when .mcpb has no inner manifest.json', () => {
    const dir = tempDir('no-inner-manifest');
    buildFixtureMcpb(dir, {
      filename: 'Concierge-GoogleWorkspace-1.0.0-darwin-arm64.mcpb',
      innerManifest: null,
      distIndexBody: distStub('2026-04-25T14:00:00.000Z', 'cccccccc'),
      junkFile: { name: 'placeholder.txt', body: 'no manifest here\n' },
    });

    const result = runScript({ CONCIERGE_MCPB_DIR: dir });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/manifest\.json/);
    rmSync(dir, { recursive: true, force: true });
  });

  it('exits non-zero when filename version disagrees with inner manifest version', () => {
    const dir = tempDir('version-mismatch');
    buildFixtureMcpb(dir, {
      filename: 'Concierge-GoogleWorkspace-1.0.0-darwin-arm64.mcpb',
      innerManifest: innerManifest('2.0.0'),
      distIndexBody: distStub('2026-04-25T14:00:00.000Z', 'dddddddd'),
    });

    const result = runScript({ CONCIERGE_MCPB_DIR: dir });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/version mismatch/);
    rmSync(dir, { recursive: true, force: true });
  });

  it('exits non-zero when dist/index.js lacks the build constants', () => {
    const dir = tempDir('no-build-constants');
    buildFixtureMcpb(dir, {
      filename: 'Concierge-GoogleWorkspace-1.0.0-darwin-arm64.mcpb',
      innerManifest: innerManifest('1.0.0'),
      distIndexBody: '// no readBuildTime / readBuildId here\n',
    });

    const result = runScript({ CONCIERGE_MCPB_DIR: dir });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/buildTime|buildId/);
    rmSync(dir, { recursive: true, force: true });
  });
});
