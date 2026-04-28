// E1 tests: exercise packages/setup/scripts/setup.sh end-to-end.
//
// Strategy: build a per-test "release dir" containing a real .tar.gz (with the
// expected `dist/index.js` layout) plus stub `.sha256`, `.sig`, `.pem` files,
// then run setup.sh under a hermetic PATH that points at our bin-e1/ stubs
// (curl, brew, node, cosign, shasum) for the prereqs while keeping /usr/bin
// + /bin on PATH for real tools (tar, mktemp, basename, cp, rm, mkdir).
//
// The bootstrap's terminal step is `exec node <extract>/dist/index.js "$@"`.
// Because our `node` stub records argv to TEST_LOG and exits 0, the bash
// process exits 0 (exec replaces the process — the EXIT trap doesn't fire,
// matching real-world behavior). We assert on the recorded `node\t<args>`
// line in the log to confirm the right entry was invoked.
//
// Per CLAUDE.md: vitest worker threads share process.env — every test that
// mutates env vars (PATH especially) MUST snapshot/restore in beforeEach /
// afterEach so parallel test files don't observe each other's mutations.

import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const SCRIPT = join(REPO_ROOT, 'packages', 'setup', 'scripts', 'setup.sh');
const FIXTURE_BIN_DIR = resolve(__dirname, '..', 'fixtures', 'bin-e1');

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runScript(args: string[], env: Record<string, string>): RunResult {
  try {
    const stdout = execFileSync('bash', [SCRIPT, ...args], {
      env: { ...env },
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

/** Build a .tar.gz with the expected `dist/index.js` + `assets/manifest.json`
 *  + `package.json` layout. Returns the path. */
function buildTarball(intoDir: string, name: string): string {
  const stage = mkdtempSync(join(tmpdir(), 'concierge-e1-stage-'));
  mkdirSync(join(stage, 'dist'), { recursive: true });
  mkdirSync(join(stage, 'assets'), { recursive: true });
  writeFileSync(join(stage, 'dist', 'index.js'), '// concierge-setup test stub\n');
  writeFileSync(
    join(stage, 'assets', 'manifest.json'),
    JSON.stringify({ schemaVersion: 1, fixture: true }),
  );
  writeFileSync(join(stage, 'package.json'), '{"name":"@concierge/setup","version":"0.0.0"}\n');
  const out = join(intoDir, name);
  execFileSync('tar', ['-czf', out, '-C', stage, '.']);
  rmSync(stage, { recursive: true, force: true });
  return out;
}

/** Build a release fixture dir mirroring what curl would download. */
function buildReleaseDir(version: string): { dir: string; tarballName: string } {
  const dir = mkdtempSync(join(tmpdir(), 'concierge-e1-release-'));
  const tarballName = `@concierge/setup-${version}-darwin-arm64.tar.gz`;
  const flat = `setup-${version}-darwin-arm64.tar.gz`;
  buildTarball(dir, flat);
  // Sibling shasum / sig / pem files (contents are placeholders — the
  // shasum + cosign shims don't actually verify, they just exit 0/1 per env).
  writeFileSync(join(dir, `${flat}.sha256`), 'deadbeef  ' + flat + '\n');
  writeFileSync(join(dir, `${flat}.sig`), 'fake-sig\n');
  writeFileSync(join(dir, `${flat}.pem`), 'fake-pem\n');
  return { dir, tarballName };
}

let savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
  'PATH',
  'VERSION',
  'CONCIERGE_TEST_FIXTURE_DIR',
  'CONCIERGE_TEST_BASE_URL',
  'CONCIERGE_TEST_ARCH',
  'CONCIERGE_TEST_COSIGN_FAIL',
  'CONCIERGE_TEST_COSIGN_INSTALL_FAIL',
  'CONCIERGE_TEST_SHA_FAIL',
  'CONCIERGE_TEST_CURL_FAIL',
  'TEST_LOG',
];

let workTmp: string;
let logPath: string;

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
  snapshotEnv();
  workTmp = mkdtempSync(join(tmpdir(), 'concierge-e1-test-'));
  logPath = join(workTmp, 'invocations.log');
  writeFileSync(logPath, '');
  // bin-e1 first so our shims shadow real curl/brew/node/cosign/shasum.
  // /usr/bin + /bin keep tar / mktemp / basename / cp / rm / mkdir resolvable.
  process.env['PATH'] = `${FIXTURE_BIN_DIR}:/usr/bin:/bin`;
  process.env['TEST_LOG'] = logPath;
});

afterEach(() => {
  restoreEnv();
  rmSync(workTmp, { recursive: true, force: true });
});

function readLog(): string[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf8').split('\n').filter(Boolean);
}

function envFor(extra: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(process.env)) {
    const v = process.env[k];
    if (v !== undefined) out[k] = v;
  }
  for (const [k, v] of Object.entries(extra)) out[k] = v;
  return out;
}

// ---------------------------------------------------------------------------

describe('packages/setup/scripts/setup.sh', () => {
  it('happy path: downloads, verifies sha + cosign, extracts, exec\'s node', () => {
    const version = '2.0.0';
    const { dir } = buildReleaseDir(version);
    const result = runScript([], envFor({
      VERSION: version,
      CONCIERGE_TEST_FIXTURE_DIR: dir,
      CONCIERGE_TEST_BASE_URL: 'https://example.test/test-release',
    }));

    expect(result.status, `setup.sh failed:\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`).toBe(0);

    const lines = readLog();
    // Curl was invoked 4 times (tarball, sha, sig, pem).
    const curlCalls = lines.filter((l) => l.startsWith('curl\t'));
    expect(curlCalls.length).toBe(4);
    // shasum + cosign each called once.
    expect(lines.filter((l) => l.startsWith('shasum\t')).length).toBe(1);
    expect(lines.filter((l) => l.startsWith('cosign\t')).length).toBe(1);
    // node was exec'd with the extracted dist/index.js as the entry.
    const nodeCalls = lines.filter((l) => l.startsWith('node\t'));
    expect(nodeCalls.length).toBe(1);
    expect(nodeCalls[0]).toMatch(/\/extract\/dist\/index\.js$/);
    // Tarball name matches the published shape (sanity: curl saw `@concierge/setup-2.0.0-...`).
    expect(curlCalls.join('\n')).toContain(`@concierge/setup-${version}-darwin-arm64.tar.gz`);

    rmSync(dir, { recursive: true, force: true });
  });

  it('SHA-256 mismatch: aborts with recovery message', () => {
    const version = '2.0.0';
    const { dir } = buildReleaseDir(version);
    const result = runScript([], envFor({
      VERSION: version,
      CONCIERGE_TEST_FIXTURE_DIR: dir,
      CONCIERGE_TEST_BASE_URL: 'https://example.test/test-release',
      CONCIERGE_TEST_SHA_FAIL: '1',
    }));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/SHA-256 mismatch/);
    expect(result.stderr).toMatch(/Manual recovery/);
    // node MUST NOT have been invoked.
    expect(readLog().some((l) => l.startsWith('node\t'))).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });

  it('cosign verify failure: aborts; NO SHA-256-only fallback', () => {
    const version = '2.0.0';
    const { dir } = buildReleaseDir(version);
    const result = runScript([], envFor({
      VERSION: version,
      CONCIERGE_TEST_FIXTURE_DIR: dir,
      CONCIERGE_TEST_BASE_URL: 'https://example.test/test-release',
      CONCIERGE_TEST_COSIGN_FAIL: '1',
    }));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/cosign signature verification failed/);
    expect(result.stderr).toMatch(/Manual recovery/);
    expect(result.stderr).not.toMatch(/falling back to sha-?256/i);
    expect(readLog().some((l) => l.startsWith('node\t'))).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });

  it('cosign install failure: aborts before any download', () => {
    // Hide cosign from PATH so ensure_cosign tries `brew install cosign`,
    // which our env-flag short-circuits to abort.
    const noCosignBin = join(workTmp, 'bin-no-cosign');
    mkdirSync(noCosignBin, { recursive: true });
    // Symlink everything from bin-e1 EXCEPT cosign into the new dir.
    for (const tool of ['curl', 'brew', 'node', 'shasum']) {
      execFileSync('ln', ['-s', join(FIXTURE_BIN_DIR, tool), join(noCosignBin, tool)]);
    }

    const version = '2.0.0';
    const { dir } = buildReleaseDir(version);
    const result = runScript([], envFor({
      PATH: `${noCosignBin}:/usr/bin:/bin`,
      VERSION: version,
      CONCIERGE_TEST_FIXTURE_DIR: dir,
      CONCIERGE_TEST_BASE_URL: 'https://example.test/test-release',
      CONCIERGE_TEST_COSIGN_INSTALL_FAIL: '1',
    }));

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/cosign install failed/);
    expect(result.stderr).toMatch(/Manual recovery/);
    // No download should have happened.
    expect(readLog().some((l) => l.startsWith('curl\t'))).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  });

  it('x86 architecture: bails with friendly message', () => {
    const result = runScript([], envFor({
      CONCIERGE_TEST_ARCH: 'x86_64',
    }));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/Apple Silicon only/);
    expect(result.stderr).toMatch(/quickstart\.md/);
    // No prereq subprocess should have been invoked.
    expect(readLog()).toEqual([]);
  });

  it('VERSION=2.0.0 vs VERSION=latest produce different release URLs', () => {
    // We're not actually fetching real GitHub URLs — assert via the curl
    // shim's invocation log that the right URL prefix was constructed.
    const version = '2.0.0';
    const { dir } = buildReleaseDir(version);

    // Pinned: should hit `releases/download/release-v2.0.0/`.
    const pinned = runScript([], envFor({
      VERSION: version,
      CONCIERGE_TEST_FIXTURE_DIR: dir,
      // Don't set CONCIERGE_TEST_BASE_URL — exercise the real URL builder.
      // The curl shim doesn't actually hit the network; it just needs the
      // basename to find the fixture, so the github.com URL is harmless.
    }));
    expect(pinned.status).toBe(0);
    const pinnedCurls = readLog().filter((l) => l.startsWith('curl\t'));
    expect(pinnedCurls[0]).toContain('releases/download/release-v2.0.0/');
    expect(pinnedCurls[0]).not.toContain('releases/latest/download/');

    // Reset log + run with VERSION=latest, but the tarball fixture filename
    // also has to be `@concierge/setup-latest-darwin-arm64.tar.gz` for the
    // curl shim to find it — build a fresh release dir.
    writeFileSync(logPath, '');
    const { dir: latestDir } = buildReleaseDir('latest');
    const latest = runScript([], envFor({
      VERSION: 'latest',
      CONCIERGE_TEST_FIXTURE_DIR: latestDir,
    }));
    expect(latest.status).toBe(0);
    const latestCurls = readLog().filter((l) => l.startsWith('curl\t'));
    expect(latestCurls[0]).toContain('releases/latest/download/');
    expect(latestCurls[0]).not.toContain('release-v');

    rmSync(dir, { recursive: true, force: true });
    rmSync(latestDir, { recursive: true, force: true });
  });

  it('tarball filename matches the @concierge/setup-<v>-darwin-arm64.tar.gz shape exactly', () => {
    const version = '2.0.0';
    const { dir, tarballName } = buildReleaseDir(version);
    expect(tarballName).toBe(`@concierge/setup-${version}-darwin-arm64.tar.gz`);
    expect(tarballName).toMatch(/^@concierge\/setup-[^/]+-darwin-arm64\.tar\.gz$/);

    const result = runScript([], envFor({
      VERSION: version,
      CONCIERGE_TEST_FIXTURE_DIR: dir,
      CONCIERGE_TEST_BASE_URL: 'https://example.test/test-release',
    }));
    expect(result.status).toBe(0);
    // Confirm the curl-targeted URL ends in the literal published filename.
    const firstCurl = readLog().find((l) => l.startsWith('curl\t')) ?? '';
    expect(firstCurl).toMatch(/@concierge\/setup-2\.0\.0-darwin-arm64\.tar\.gz$/);

    rmSync(dir, { recursive: true, force: true });
  });
});
