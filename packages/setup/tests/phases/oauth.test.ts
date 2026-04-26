// Tests for C4: phases/oauth.ts.
//
// These tests exercise the real `gws` shim binary via real `child_process`
// spawn — the SUT's whole job is correct subprocess interaction (line-by-line
// stderr streaming, exit-code parsing, stdin/stdout inheritance), so mocking
// child_process would defeat the point. We isolate state via per-test
// tempdirs piped through the shim's `CONCIERGE_TEST_GWS_DIR` env contract.
//
// Resolution: SHIM points at the repo-root fixtures dir
// (packages/setup/tests/phases/ → ../../../../tests/fixtures/bin/gws).

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SHIM = resolve(__dirname, '../../../../tests/fixtures/bin/gws');

interface EnvOverrides {
  bin?: string;
  dir?: string;
  user?: string;
  portCollision?: boolean;
}

let savedEnv: Record<string, string | undefined> = {};
let tmp: string;

function applyEnv(overrides: EnvOverrides): void {
  const keys = [
    'CONCIERGE_TEST_GWS_BIN',
    'CONCIERGE_TEST_GWS_DIR',
    'CONCIERGE_TEST_GWS_USER',
    'CONCIERGE_TEST_GWS_PORT_COLLISION',
  ];
  savedEnv = Object.fromEntries(keys.map((k) => [k, process.env[k]]));

  process.env['CONCIERGE_TEST_GWS_BIN'] = overrides.bin ?? SHIM;
  process.env['CONCIERGE_TEST_GWS_DIR'] = overrides.dir ?? tmp;
  if (overrides.user !== undefined) {
    process.env['CONCIERGE_TEST_GWS_USER'] = overrides.user;
  } else {
    delete process.env['CONCIERGE_TEST_GWS_USER'];
  }
  if (overrides.portCollision === true) {
    process.env['CONCIERGE_TEST_GWS_PORT_COLLISION'] = '1';
  } else {
    delete process.env['CONCIERGE_TEST_GWS_PORT_COLLISION'];
  }
}

function restoreEnv(): void {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'concierge-oauth-test-'));
});

afterEach(() => {
  restoreEnv();
  rmSync(tmp, { recursive: true, force: true });
});

// Dynamic import inside each test so env overrides apply to module-level
// helpers that capture process.env at call time (they do — see `resolveGwsBin`
// — but the dynamic import keeps the test layout honest if that ever changes).
async function loadSut(): Promise<typeof import('../../src/phases/oauth.js')> {
  return import('../../src/phases/oauth.js');
}

describe('classifyAccountDomain', () => {
  it('classifies user@gmail.com as personal', async () => {
    const sut = await loadSut();
    expect(sut.classifyAccountDomain('user@gmail.com')).toBe('personal');
  });

  it('classifies user@acme.com as workspace', async () => {
    const sut = await loadSut();
    expect(sut.classifyAccountDomain('user@acme.com')).toBe('workspace');
  });

  it('classifies googlemail.com (legacy alias) as personal', async () => {
    const sut = await loadSut();
    expect(sut.classifyAccountDomain('user@googlemail.com')).toBe('personal');
  });

  it('treats malformed input as workspace (conservative default)', async () => {
    const sut = await loadSut();
    expect(sut.classifyAccountDomain('no-at-sign')).toBe('workspace');
    expect(sut.classifyAccountDomain('trailing-at@')).toBe('workspace');
  });
});

describe('runGwsAuthSetup', () => {
  it('happy path returns ok with project_id from shim fixture', async () => {
    applyEnv({});
    const sut = await loadSut();
    const result = await sut.runGwsAuthSetup({
      suggestedProjectId: 'my-real-project',
      accountType: 'personal',
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.projectId).toBe('concierge-test-shim');
    }
  });

  it('placeholder project_id detection fires on canonical placeholder pattern', async () => {
    applyEnv({});
    // The shim writes `concierge-test-shim` which matches the placeholder
    // family. Override that with a fixture file written before invocation —
    // but the shim overwrites on `auth setup`. Instead we let the shim run,
    // then truncate-rewrite client_secret.json to a known placeholder, then
    // *separately* assert detection via a controlled file. Simplest: write
    // the file ourselves and use a no-op shim that exits 0 without touching
    // the dir.
    //
    // Implementation: write a placeholder client_secret.json + use `/bin/true`
    // as the gws stand-in so the wrapper just observes exit 0 and reads the
    // file we planted.
    writeFileSync(
      join(tmp, 'client_secret.json'),
      JSON.stringify({ installed: { project_id: 'authtools-spike' } }),
    );
    applyEnv({ bin: '/usr/bin/true' });
    const sut = await loadSut();
    const result = await sut.runGwsAuthSetup({
      suggestedProjectId: 'whatever',
      accountType: 'personal',
    });
    expect(result.kind).toBe('placeholder_project_id');
    if (result.kind === 'placeholder_project_id') {
      expect(result.suspectedProjectId).toBe('authtools-spike');
    }
  });

  it('returns subprocess_failed when the binary exits non-zero with no punt signal', async () => {
    applyEnv({ bin: '/usr/bin/false' });
    const sut = await loadSut();
    const result = await sut.runGwsAuthSetup({
      suggestedProjectId: 'whatever',
      accountType: 'personal',
    });
    expect(result.kind).toBe('subprocess_failed');
    if (result.kind === 'subprocess_failed') {
      expect(result.exitCode).toBe(1);
    }
  });
});

describe('runGwsAuthLogin', () => {
  it('happy path (personal Gmail) returns ok with user + scopes', async () => {
    // Pre-populate with a setup so login has a place to write status.
    execFileSync(SHIM, ['auth', 'setup'], {
      env: { ...process.env, CONCIERGE_TEST_GWS_DIR: tmp },
    });
    applyEnv({ user: 'alice@gmail.com' });
    const sut = await loadSut();
    const result = await sut.runGwsAuthLogin({
      services: ['gmail', 'drive'],
      expectedAccountType: 'personal',
    });
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.user).toBe('alice@gmail.com');
      expect(result.tokenValid).toBe(true);
      expect(result.scopes.length).toBeGreaterThanOrEqual(2);
      expect(result.scopes).toContain('https://www.googleapis.com/auth/drive');
    }
  });

  it('happy path (workspace) returns ok for a custom domain', async () => {
    execFileSync(SHIM, ['auth', 'setup'], {
      env: { ...process.env, CONCIERGE_TEST_GWS_DIR: tmp },
    });
    applyEnv({ user: 'alice@acme.com' });
    const sut = await loadSut();
    const result = await sut.runGwsAuthLogin({
      services: ['gmail', 'drive'],
      expectedAccountType: 'workspace',
    });
    expect(result.kind).toBe('ok');
  });

  it('detects port collision via stderr streaming', async () => {
    applyEnv({ portCollision: true });
    const sut = await loadSut();
    const result = await sut.runGwsAuthLogin({
      services: ['gmail'],
      expectedAccountType: 'personal',
    });
    expect(result.kind).toBe('port_collision');
    if (result.kind === 'port_collision') {
      expect(result.port).toBe(8080);
      expect(result.rawStderrLine).toContain('bind: address already in use');
    }
  });

  it('detects account mismatch when user signs in with personal Gmail but declared workspace', async () => {
    execFileSync(SHIM, ['auth', 'setup'], {
      env: { ...process.env, CONCIERGE_TEST_GWS_DIR: tmp },
    });
    applyEnv({ user: 'alice@gmail.com' });
    const sut = await loadSut();
    const result = await sut.runGwsAuthLogin({
      services: ['gmail'],
      expectedAccountType: 'workspace',
    });
    expect(result.kind).toBe('account_mismatch');
    if (result.kind === 'account_mismatch') {
      expect(result.userDomain).toBe('gmail.com');
      expect(result.expectedType).toBe('workspace');
      expect(result.actualType).toBe('personal');
    }
  });

  it('detects account mismatch when user signs in with workspace domain but declared personal', async () => {
    execFileSync(SHIM, ['auth', 'setup'], {
      env: { ...process.env, CONCIERGE_TEST_GWS_DIR: tmp },
    });
    applyEnv({ user: 'admin@acme.com' });
    const sut = await loadSut();
    const result = await sut.runGwsAuthLogin({
      services: ['gmail'],
      expectedAccountType: 'personal',
    });
    expect(result.kind).toBe('account_mismatch');
    if (result.kind === 'account_mismatch') {
      expect(result.actualType).toBe('workspace');
      expect(result.expectedType).toBe('personal');
    }
  });
});
