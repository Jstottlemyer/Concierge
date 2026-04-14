// remove_account (T14) — confirmation-guarded account disconnect.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { GWS_BIN_ENV } from '../../../src/gws/paths.js';
import { __resetVersionCacheForTests } from '../../../src/gws/runner.js';
import { __resetCachesForTests as resetGrantedCaches } from '../../../src/auth/granted-bundles.js';
import { removeAccount } from '../../../src/tools/management/remove-account.js';
import { loadState, writeState } from '../../../src/state/loader.js';
import type { ToolContext } from '../../../src/tools/types.js';
import { installGwsMock, type InstalledGwsMock } from '../../helpers/gws-mock.js';
import { makeVersionScenario } from '../../helpers/gws-mock-scenarios.js';

const ctx: ToolContext = { now: '2026-04-13T00:00:00.000Z' };

let tmpDir: string;
let priorStateEnv: string | undefined;
let priorBinEnv: string | undefined;
let mock: InstalledGwsMock | null = null;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'authtools-mgmt-remove-'));
  priorStateEnv = process.env['CONCIERGE_STATE_DIR'];
  priorBinEnv = process.env[GWS_BIN_ENV];
  process.env['CONCIERGE_STATE_DIR'] = tmpDir;
  __resetVersionCacheForTests();
  resetGrantedCaches();
});

afterEach(async () => {
  if (mock !== null) {
    await mock.uninstall();
    mock = null;
  }
  if (priorStateEnv === undefined) delete process.env['CONCIERGE_STATE_DIR'];
  else process.env['CONCIERGE_STATE_DIR'] = priorStateEnv;
  if (priorBinEnv === undefined) delete process.env[GWS_BIN_ENV];
  else process.env[GWS_BIN_ENV] = priorBinEnv;
  await fs.rm(tmpDir, { recursive: true, force: true });
  __resetVersionCacheForTests();
  resetGrantedCaches();
});

async function seedTwoAccounts(): Promise<void> {
  await writeState({
    state_schema_version: 1,
    default_account: 'alice@example.com',
    accounts: {
      'alice@example.com': { read_only: false },
      'bob@example.com': { read_only: false },
    },
  });
}

describe('remove_account metadata', () => {
  it('declares expected tool metadata', () => {
    expect(removeAccount.name).toBe('remove_account');
    expect(removeAccount.service).toBe('management');
    expect(removeAccount.readonly).toBe(false);
  });
});

describe('remove_account confirmation flow', () => {
  it('rejects when the account is not connected', async () => {
    await writeState({
      state_schema_version: 1,
      default_account: null,
      accounts: {},
    });

    const result = await removeAccount.invoke({ email: 'ghost@example.com' }, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('validation_error');
  });

  it('first call (no confirm) returns confirmation_required with the phrase + next_call', async () => {
    await seedTwoAccounts();
    mock = await installGwsMock({ scenarios: [makeVersionScenario()] });

    const result = await removeAccount.invoke({ email: 'alice@example.com' }, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('confirmation_required');
    expect(result.error.confirmation_phrase).toBe('remove alice@example.com');
    expect(result.error.next_call?.tool).toBe('remove_account');
    expect(result.error.next_call?.arguments).toEqual({
      email: 'alice@example.com',
      confirm: 'remove alice@example.com',
    });
    // Warning text calls out the email + keychain deletion.
    expect(result.error.message).toContain('alice@example.com');
    expect(result.error.message.toLowerCase()).toContain('keychain');

    // State unchanged (no revoke/logout spawned).
    const reloaded = await loadState();
    expect(Object.keys(reloaded.accounts)).toContain('alice@example.com');
  });

  it('wrong confirm returns confirmation_mismatch and does not delete', async () => {
    await seedTwoAccounts();
    mock = await installGwsMock({ scenarios: [makeVersionScenario()] });

    const result = await removeAccount.invoke(
      { email: 'alice@example.com', confirm: 'remove bob@example.com' },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('confirmation_mismatch');
    expect(result.error.confirmation_phrase).toBe('remove alice@example.com');

    const reloaded = await loadState();
    expect(Object.keys(reloaded.accounts).sort()).toEqual([
      'alice@example.com',
      'bob@example.com',
    ]);
  });

  it('correct confirm runs revoke + logout and updates state', async () => {
    await seedTwoAccounts();

    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: ['auth', 'revoke', '--account', 'alice@example.com'],
          stdout: '',
          exitCode: 0,
        },
        {
          matchArgs: ['auth', 'logout', '--account', 'alice@example.com'],
          stdout: '',
          exitCode: 0,
        },
      ],
    });

    const result = await removeAccount.invoke(
      { email: 'alice@example.com', confirm: 'remove alice@example.com' },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.removed_email).toBe('alice@example.com');
    expect(result.data.revoke_ok).toBe(true);
    expect(result.data.logout_ok).toBe(true);
    // Alice was default → default cleared.
    expect(result.data.new_default_account).toBeNull();

    // State reflects removal.
    const reloaded = await loadState();
    expect(reloaded.accounts['alice@example.com']).toBeUndefined();
    expect(reloaded.accounts['bob@example.com']).toBeDefined();
    expect(reloaded.default_account).toBeNull();

    // Both gws subcommands were invoked.
    const calls = mock.calls.map((c) => c.args);
    const revokeSeen = calls.some(
      (a) => a[0] === 'auth' && a[1] === 'revoke' && a.includes('alice@example.com'),
    );
    const logoutSeen = calls.some(
      (a) => a[0] === 'auth' && a[1] === 'logout' && a.includes('alice@example.com'),
    );
    expect(revokeSeen).toBe(true);
    expect(logoutSeen).toBe(true);
  });

  it('continues with logout + state update when revoke fails', async () => {
    await seedTwoAccounts();

    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: ['auth', 'revoke', '--account', 'alice@example.com'],
          stderr: 'network error\n',
          exitCode: 1,
        },
        {
          matchArgs: ['auth', 'logout', '--account', 'alice@example.com'],
          stdout: '',
          exitCode: 0,
        },
      ],
    });

    const result = await removeAccount.invoke(
      { email: 'alice@example.com', confirm: 'remove alice@example.com' },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.revoke_ok).toBe(false);
    expect(result.data.logout_ok).toBe(true);

    const reloaded = await loadState();
    expect(reloaded.accounts['alice@example.com']).toBeUndefined();
  });

  it('preserves a non-matching default account', async () => {
    // bob is default; remove alice.
    await writeState({
      state_schema_version: 1,
      default_account: 'bob@example.com',
      accounts: {
        'alice@example.com': { read_only: false },
        'bob@example.com': { read_only: false },
      },
    });

    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: ['auth', 'revoke', '--account', 'alice@example.com'],
          stdout: '',
          exitCode: 0,
        },
        {
          matchArgs: ['auth', 'logout', '--account', 'alice@example.com'],
          stdout: '',
          exitCode: 0,
        },
      ],
    });

    const result = await removeAccount.invoke(
      { email: 'alice@example.com', confirm: 'remove alice@example.com' },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.new_default_account).toBe('bob@example.com');

    const reloaded = await loadState();
    expect(reloaded.default_account).toBe('bob@example.com');
  });
});
