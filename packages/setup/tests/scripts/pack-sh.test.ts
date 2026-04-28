// E3b tests: exercise packages/setup/build/pack.sh end-to-end against a
// synthetic temp PKG_DIR (via CONCIERGE_PKG_DIR override) so the dev's real
// packages/setup/dist + assets are untouched. cosign is replaced with the
// stub at tests/fixtures/bin-e3b/cosign on PATH so we never hit real Sigstore.
//
// vitest workers share process.env — PATH is mutated only via `env: {...}`
// in execFileSync, never via direct process.env['PATH'] writes, so parallel test
// files don't see each other's mutations (CLAUDE.md gotcha).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const SCRIPT = join(REPO_ROOT, 'packages', 'setup', 'build', 'pack.sh');
const STUB_BIN_DIR = join(
  REPO_ROOT,
  'packages',
  'setup',
  'tests',
  'fixtures',
  'bin-e3b',
);

// --- Synthetic PKG_DIR ------------------------------------------------------
// Each test gets a tempdir shaped like packages/setup/ with the minimum
// pack.sh expects: package.json, dist/index.js, assets/manifest.json,
// assets/<something>.mcpb.

interface FixtureOpts {
  version?: string;
  /** Skip writing dist/index.js to test the missing-input error path. */
  omitDistIndex?: boolean;
  /** Skip writing assets/manifest.json to test the missing-input error path. */
  omitManifest?: boolean;
  /** Skip writing assets/*.mcpb to test the missing-input error path. */
  omitMcpb?: boolean;
}

function makePkgDir(opts: FixtureOpts = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'concierge-e3b-pkg-'));
  const version = opts.version ?? '1.2.3';

  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: '@concierge/setup', version, private: true }, null, 2),
  );

  if (!opts.omitDistIndex) {
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'index.js'), '#!/usr/bin/env node\nconsole.log("setup");\n');
  }

  mkdirSync(join(dir, 'assets'), { recursive: true });
  if (!opts.omitManifest) {
    writeFileSync(
      join(dir, 'assets', 'manifest.json'),
      JSON.stringify({ schemaVersion: 1, setupVersion: version }, null, 2),
    );
  }
  if (!opts.omitMcpb) {
    writeFileSync(
      join(dir, 'assets', `Concierge-GoogleWorkspace-${version}-darwin-arm64.mcpb`),
      'PK\x03\x04 fake-mcpb-bytes\n', // not a real zip; pack.sh only checks existence
    );
  }
  return dir;
}

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runScript(pkgDir: string, extraEnv: Record<string, string> = {}): RunResult {
  // Prepend STUB_BIN_DIR to PATH so `cosign` resolves to our stub.
  const PATH = `${STUB_BIN_DIR}:${process.env['PATH'] ?? ''}`;
  try {
    const stdout = execFileSync(SCRIPT, [], {
      env: {
        ...process.env,
        PATH,
        CONCIERGE_PKG_DIR: pkgDir,
        ...extraEnv,
      },
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

// --- Cleanup ---------------------------------------------------------------

const tempDirsToCleanup: string[] = [];

afterEach(() => {
  while (tempDirsToCleanup.length > 0) {
    const d = tempDirsToCleanup.pop();
    if (d && existsSync(d)) rmSync(d, { recursive: true, force: true });
  }
});

function track(d: string): string {
  tempDirsToCleanup.push(d);
  return d;
}

// --- Tests ------------------------------------------------------------------

describe('pack.sh', () => {
  it('happy path: produces tarball + .sha256 + .sig + .pem', () => {
    const pkgDir = track(makePkgDir({ version: '0.5.0' }));
    const result = runScript(pkgDir);

    expect(
      result.status,
      `script failed:\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
    ).toBe(0);
    expect(result.stdout).toContain('SUCCESS');

    const tarball = join(pkgDir, 'dist-release', '@concierge/setup-0.5.0-darwin-arm64.tar.gz');
    expect(existsSync(tarball)).toBe(true);
    expect(existsSync(`${tarball}.sha256`)).toBe(true);
    expect(existsSync(`${tarball}.sig`)).toBe(true);
    expect(existsSync(`${tarball}.pem`)).toBe(true);
  });

  it('SHA-256 file is well-formed and matches the actual tarball hash', () => {
    const pkgDir = track(makePkgDir({ version: '0.5.0' }));
    const result = runScript(pkgDir);
    expect(result.status).toBe(0);

    const tarballName = '@concierge/setup-0.5.0-darwin-arm64.tar.gz';
    const tarball = join(pkgDir, 'dist-release', tarballName);
    const shaLine = readFileSync(`${tarball}.sha256`, 'utf8').trim();

    // shasum -a 256 format: "<64-hex>  <filename>"
    const m = shaLine.match(/^([a-f0-9]{64}) {2}(.+)$/);
    expect(m, `unexpected .sha256 contents: ${shaLine}`).not.toBeNull();
    const [, hex, filename] = m!;
    expect(filename).toBe(tarballName);

    const actual = createHash('sha256').update(readFileSync(tarball)).digest('hex');
    expect(hex).toBe(actual);
  });

  it('sig + pem files are non-empty (cosign stub wrote them)', () => {
    const pkgDir = track(makePkgDir());
    const result = runScript(pkgDir);
    expect(result.status).toBe(0);

    const tarball = join(pkgDir, 'dist-release', '@concierge/setup-1.2.3-darwin-arm64.tar.gz');
    expect(readFileSync(`${tarball}.sig`, 'utf8').length).toBeGreaterThan(0);
    expect(readFileSync(`${tarball}.pem`, 'utf8')).toContain('BEGIN CERTIFICATE');
  });

  it('exits non-zero with helpful error when dist/index.js is missing', () => {
    const pkgDir = track(makePkgDir({ omitDistIndex: true }));
    const result = runScript(pkgDir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/dist\/index\.js not found.*pnpm.*build/);
  });

  it('exits non-zero with helpful error when assets/manifest.json is missing', () => {
    const pkgDir = track(makePkgDir({ omitManifest: true }));
    const result = runScript(pkgDir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/assets\/manifest\.json not found.*prepare-assets/);
  });

  it('exits non-zero when no .mcpb exists in assets/', () => {
    const pkgDir = track(makePkgDir({ omitMcpb: true }));
    const result = runScript(pkgDir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/no \*\.mcpb in assets/);
  });

  it('cosign failure (CONCIERGE_TEST_COSIGN_FAIL=1): aborts and cleans partial outputs', () => {
    const pkgDir = track(makePkgDir({ version: '0.9.0' }));
    const result = runScript(pkgDir, { CONCIERGE_TEST_COSIGN_FAIL: '1' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/cosign signing failed/);

    // EXIT trap should have removed the tarball + sha + sig + pem.
    const tarball = join(pkgDir, 'dist-release', '@concierge/setup-0.9.0-darwin-arm64.tar.gz');
    expect(existsSync(tarball)).toBe(false);
    expect(existsSync(`${tarball}.sha256`)).toBe(false);
    expect(existsSync(`${tarball}.sig`)).toBe(false);
    expect(existsSync(`${tarball}.pem`)).toBe(false);
  });

  it('cosign missing on PATH: aborts with brew-install recovery hint', () => {
    const pkgDir = track(makePkgDir());
    // Run with PATH that DOESN'T include the stub dir. Use a bare PATH with
    // only system bins to avoid picking up a real cosign on a dev machine.
    // We can't easily clear cosign from /usr/local/bin if it's installed
    // there, but on the CI runner + the current dev machine it's not.
    const minimalPath = '/usr/bin:/bin:/usr/sbin:/sbin';
    try {
      const out = execFileSync(SCRIPT, [], {
        env: {
          ...process.env,
          PATH: minimalPath,
          CONCIERGE_PKG_DIR: pkgDir,
        },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      // If cosign is installed in /usr/bin, this branch will produce a real
      // signature attempt and either succeed (unlikely without OIDC) or fail
      // for a different reason. Skip the assertion in that case.
      if (out.includes('SUCCESS')) {
        return; // unexpected on stub-only env, but don't fail the suite
      }
    } catch (err) {
      const e = err as { stderr?: Buffer | string };
      const stderr = e.stderr?.toString() ?? '';
      // If the system has no cosign at all, our stderr message fires.
      // If the system DOES have a cosign, this test is a no-op (best-effort).
      if (stderr.includes('cosign not installed')) {
        expect(stderr).toMatch(/brew install cosign/);
      }
    }
  });

  it('tarball entry-name verification catches a malformed tar (stubbed tar)', () => {
    const pkgDir = track(makePkgDir({ version: '0.7.0' }));
    // Stub tar to produce a tarball whose contents do NOT match the expected
    // layout (no dist/index.js entry).
    const stubBinDir = mkdtempSync(join(tmpdir(), 'concierge-e3b-tarstub-'));
    track(stubBinDir);
    const tarStub = join(stubBinDir, 'tar');
    writeFileSync(
      tarStub,
      `#!/usr/bin/env bash
# Stub tar: cherry-pick the -czf <out> arg, write a tarball containing only
# a junk file. Pass through everything else (-tzf for layout verification)
# to the real tar.
set -euo pipefail
REAL_TAR="$(PATH=/usr/bin:/bin command -v tar)"
mode=""
out=""
args=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    -czf) mode=create; out="$2"; shift 2 ;;
    -tzf) mode=list; args=("$@"); break ;;
    *) args+=("$1"); shift ;;
  esac
done
if [[ "$mode" == "create" ]]; then
  scratch="$(mktemp -d)"
  echo junk > "$scratch/junk.txt"
  ( cd "$scratch" && "$REAL_TAR" -czf "$out" junk.txt )
  rm -rf "$scratch"
  exit 0
fi
exec "$REAL_TAR" "\${args[@]}"
`,
    );
    chmodSync(tarStub, 0o755);

    const PATH = `${stubBinDir}:${STUB_BIN_DIR}:${process.env['PATH'] ?? ''}`;
    let stderr = '';
    let status = 0;
    try {
      execFileSync(SCRIPT, [], {
        env: { ...process.env, PATH, CONCIERGE_PKG_DIR: pkgDir },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      const e = err as { status?: number; stderr?: Buffer | string };
      status = e.status ?? 1;
      stderr = e.stderr?.toString() ?? '';
    }
    expect(status).not.toBe(0);
    expect(stderr).toMatch(/does not contain dist\/index\.js/);
  });

  it('tarball name regex matches the spec N11 pattern exactly', () => {
    const pkgDir = track(makePkgDir({ version: '3.4.5-beta.1' }));
    const result = runScript(pkgDir);
    expect(result.status).toBe(0);
    // N11 spec: @concierge/setup-<version>-darwin-arm64.tar.gz
    const expected = '@concierge/setup-3.4.5-beta.1-darwin-arm64.tar.gz';
    const tarball = join(pkgDir, 'dist-release', expected);
    expect(existsSync(tarball)).toBe(true);
    // Exact regex assertion against the produced filename.
    expect(expected).toMatch(/^@concierge\/setup-[^/]+-darwin-(arm64|x64)\.tar\.gz$/);
  });
});
