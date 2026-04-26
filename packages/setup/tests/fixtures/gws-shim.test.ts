import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve } from 'node:path';

const execFileAsync = promisify(execFile);

// Resolve the shim relative to repo root: packages/setup/tests/fixtures/ -> ../../../../tests/fixtures/bin/gws
const SHIM = resolve(__dirname, '../../../../tests/fixtures/bin/gws');

interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

async function runShim(args: string[], env: NodeJS.ProcessEnv = {}): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync(SHIM, args, {
      env: { ...process.env, ...env },
      encoding: 'utf8',
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      code: typeof e.code === 'number' ? e.code : 1,
    };
  }
}

describe('gws test shim', () => {
  let tmp: string;
  let snapshotRealGwsDir: { existed: boolean; mtimeMs?: number };

  // Snapshot the real ~/.config/gws once so we can verify nothing touched it.
  const realGwsDir = join(homedir(), '.config', 'gws');

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'gws-shim-test-'));
    if (existsSync(realGwsDir)) {
      const st = statSync(realGwsDir);
      snapshotRealGwsDir = { existed: true, mtimeMs: st.mtimeMs };
    } else {
      snapshotRealGwsDir = { existed: false };
    }
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    if (snapshotRealGwsDir.existed) {
      expect(existsSync(realGwsDir)).toBe(true);
      const st = statSync(realGwsDir);
      expect(st.mtimeMs).toBe(snapshotRealGwsDir.mtimeMs);
    } else {
      expect(existsSync(realGwsDir)).toBe(false);
    }
  });

  it('--version returns expected string and exits 0', async () => {
    const res = await runShim(['--version']);
    expect(res.code).toBe(0);
    expect(res.stdout.trim()).toBe('gws 0.22.5 (test shim)');
  });

  it('auth setup writes valid client_secret.json with correct project_id', async () => {
    const res = await runShim(['auth', 'setup'], { CONCIERGE_TEST_GWS_DIR: tmp });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Created OAuth client for project: concierge-test-shim');
    const doc = JSON.parse(readFileSync(join(tmp, 'client_secret.json'), 'utf8'));
    expect(doc.installed.project_id).toBe('concierge-test-shim');
    expect(doc.installed.client_id).toBe('493302-test-shim.apps.googleusercontent.com');
    expect(doc.installed.client_secret).toBe('GOCSPX-fake-client-secret-for-test');
    expect(doc.installed.auth_uri).toBe('https://accounts.google.com/o/oauth2/auth');
    expect(doc.installed.token_uri).toBe('https://oauth2.googleapis.com/token');
    expect(doc.installed.redirect_uris).toEqual(['http://localhost']);
  });

  it('auth setup without $CONCIERGE_TEST_GWS_DIR exits 2 with documented stderr', async () => {
    const cleanEnv: NodeJS.ProcessEnv = { ...process.env };
    delete cleanEnv['CONCIERGE_TEST_GWS_DIR'];
    try {
      await execFileAsync(SHIM, ['auth', 'setup'], { env: cleanEnv, encoding: 'utf8' });
      throw new Error('expected non-zero exit');
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { stderr?: string; code?: number };
      expect(e.code).toBe(2);
      expect(e.stderr).toContain('refusing to touch ~/.config/gws');
    }
  });

  it('auth login --services drive,gmail writes auth-status.json with token_valid: true', async () => {
    const res = await runShim(['auth', 'login', '--services', 'drive,gmail'], {
      CONCIERGE_TEST_GWS_DIR: tmp,
    });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Authenticated test@example.com');
    const doc = JSON.parse(readFileSync(join(tmp, 'auth-status.json'), 'utf8'));
    expect(doc.user).toBe('test@example.com');
    expect(doc.token_valid).toBe(true);
    expect(doc.encrypted_credentials_exists).toBe(true);
    expect(doc.project_id).toBe('concierge-test-shim');
    expect(Array.isArray(doc.scopes)).toBe(true);
    expect(doc.scopes.length).toBeGreaterThanOrEqual(8);
    expect(doc.scopes).toContain('https://www.googleapis.com/auth/gmail.modify');
    expect(doc.scopes).toContain('https://www.googleapis.com/auth/drive');
  });

  it('auth login honors CONCIERGE_TEST_GWS_USER override', async () => {
    const res = await runShim(['auth', 'login', '--services', 'drive'], {
      CONCIERGE_TEST_GWS_DIR: tmp,
      CONCIERGE_TEST_GWS_USER: 'ceo@pashion.example',
    });
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('Authenticated ceo@pashion.example');
    const doc = JSON.parse(readFileSync(join(tmp, 'auth-status.json'), 'utf8'));
    expect(doc.user).toBe('ceo@pashion.example');
  });

  it('auth login with CONCIERGE_TEST_GWS_PORT_COLLISION=1 emits bind-failure stderr and exits 1', async () => {
    const res = await runShim(['auth', 'login', '--services', 'drive'], {
      CONCIERGE_TEST_GWS_DIR: tmp,
      CONCIERGE_TEST_GWS_PORT_COLLISION: '1',
    });
    expect(res.code).toBe(1);
    expect(res.stderr).toContain('bind: address already in use');
    expect(res.stderr).toContain('port 8080');
    // No auth-status.json should have been written.
    expect(existsSync(join(tmp, 'auth-status.json'))).toBe(false);
  });

  it('auth status reads back what auth login wrote', async () => {
    const env = { CONCIERGE_TEST_GWS_DIR: tmp, CONCIERGE_TEST_GWS_USER: 'roundtrip@example.com' };
    const loginRes = await runShim(['auth', 'login', '--services', 'drive,gmail'], env);
    expect(loginRes.code).toBe(0);
    const statusRes = await runShim(['auth', 'status'], { CONCIERGE_TEST_GWS_DIR: tmp });
    expect(statusRes.code).toBe(0);
    const doc = JSON.parse(statusRes.stdout);
    expect(doc.user).toBe('roundtrip@example.com');
    expect(doc.token_valid).toBe(true);
    expect(doc.project_id).toBe('concierge-test-shim');
  });

  it('auth status with no prior auth returns exit 2 + "no credentials found" stderr', async () => {
    const res = await runShim(['auth', 'status'], { CONCIERGE_TEST_GWS_DIR: tmp });
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('no credentials found');
  });

  it('unknown subcommand exits 1 with documented stderr', async () => {
    const res = await runShim(['gmail', 'send']);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("Error: test shim does not implement 'gmail send'.");
  });
});
