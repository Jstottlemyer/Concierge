// E4 tests: assert the sync-check script catches divergence and passes when
// the two setup.sh copies match.
//
// We invoke the real script against a synthesized repo layout in a tempdir so
// we don't risk mutating the real scripts/ directory or affecting the actual
// CI gate.

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../../../..');
const SCRIPT_SRC = join(REPO_ROOT, 'packages/setup/scripts/check-setup-sh-sync.sh');
const REAL_SETUP_SH = join(REPO_ROOT, 'packages/setup/scripts/setup.sh');

let tmp: string;
let scriptUnderTest: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'concierge-e4-test-'));

  // Synthesize repo layout: <tmp>/packages/setup/scripts/{setup.sh,check-setup-sh-sync.sh}
  // and <tmp>/scripts/setup.sh. The script computes REPO_ROOT as $script/../../..,
  // so it'll resolve correctly inside the tempdir.
  mkdirSync(join(tmp, 'packages/setup/scripts'), { recursive: true });
  mkdirSync(join(tmp, 'scripts'), { recursive: true });

  copyFileSync(REAL_SETUP_SH, join(tmp, 'packages/setup/scripts/setup.sh'));
  copyFileSync(REAL_SETUP_SH, join(tmp, 'scripts/setup.sh'));

  scriptUnderTest = join(tmp, 'packages/setup/scripts/check-setup-sh-sync.sh');
  copyFileSync(SCRIPT_SRC, scriptUnderTest);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function runScript(): { stdout: string; stderr: string; exitCode: number } {
  try {
    const out = execFileSync('bash', [scriptUnderTest], {
      stdio: 'pipe',
      encoding: 'utf8',
    });
    return { stdout: out, stderr: '', exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; status?: number };
    return {
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
      exitCode: e.status ?? -1,
    };
  }
}

describe('check-setup-sh-sync.sh', () => {
  it('passes when both copies are byte-identical', () => {
    const r = runScript();
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('OK');
  });

  it('fails with a diff when the root copy diverges', () => {
    writeFileSync(join(tmp, 'scripts/setup.sh'), '#!/usr/bin/env bash\n# tampered\n');
    const r = runScript();
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('diverged');
    expect(r.stderr).toContain('Recover with: cp');
  });

  it('exits 2 when the source-of-truth is missing', () => {
    rmSync(join(tmp, 'packages/setup/scripts/setup.sh'));
    const r = runScript();
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('source-of-truth missing');
  });

  it('exits 2 when the root copy is missing', () => {
    rmSync(join(tmp, 'scripts/setup.sh'));
    const r = runScript();
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('root copy missing');
    expect(r.stderr).toContain('Recover with: cp');
  });
});
