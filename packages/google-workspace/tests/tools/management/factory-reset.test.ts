// factory_reset (T14) — confirmation-guarded; disconnects all accounts and
// resets state.json to a fresh v1.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { GWS_BIN_ENV } from '../../../src/gws/paths.js';
import { __resetVersionCacheForTests } from '../../../src/gws/runner.js';
import { __resetCachesForTests as resetGrantedCaches } from '../../../src/auth/granted-bundles.js';
import { factoryReset } from '../../../src/tools/management/factory-reset.js';
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
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'authtools-mgmt-reset-'));
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

describe('factory_reset metadata', () => {
  it('declares expected tool metadata', () => {
    expect(factoryReset.name).toBe('factory_reset');
    expect(factoryReset.service).toBe('management');
    expect(factoryReset.readonly).toBe(false);
  });
});

describe('factory_reset confirmation flow', () => {
  it('first call returns confirmation_required with the fixed phrase + next_call', async () => {
    await writeState({
      state_schema_version: 1,
      default_account: 'alice@example.com',
      accounts: {
        'alice@example.com': { read_only: false },
        'bob@example.com': { read_only: false },
      },
    });
    mock = await installGwsMock({ scenarios: [makeVersionScenario()] });

    const result = await factoryReset.invoke({}, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('confirmation_required');
    expect(result.error.confirmation_phrase).toBe('yes delete all my google credentials');
    expect(result.error.next_call?.tool).toBe('factory_reset');
    expect(result.error.next_call?.arguments).toEqual({
      confirm: 'yes delete all my google credentials',
    });
    // Warning surfaces the account list.
    expect(result.error.message).toContain('alice@example.com');
    expect(result.error.message).toContain('bob@example.com');

    // State untouched.
    const reloaded = await loadState();
    expect(Object.keys(reloaded.accounts)).toHaveLength(2);
  });

  it('wrong confirm returns confirmation_mismatch and does not reset', async () => {
    await writeState({
      state_schema_version: 1,
      default_account: 'alice@example.com',
      accounts: { 'alice@example.com': { read_only: false } },
    });
    mock = await installGwsMock({ scenarios: [makeVersionScenario()] });

    const result = await factoryReset.invoke({ confirm: 'nope' }, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('confirmation_mismatch');
    expect(result.error.confirmation_phrase).toBe('yes delete all my google credentials');

    const reloaded = await loadState();
    expect(Object.keys(reloaded.accounts)).toHaveLength(1);
  });

  it('correct confirm runs revoke + logout per account and resets state', async () => {
    await writeState({
      state_schema_version: 1,
      default_account: 'alice@example.com',
      accounts: {
        'alice@example.com': { read_only: false },
        'bob@example.com': { read_only: true },
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
        {
          matchArgs: ['auth', 'revoke', '--account', 'bob@example.com'],
          stdout: '',
          exitCode: 0,
        },
        {
          matchArgs: ['auth', 'logout', '--account', 'bob@example.com'],
          stdout: '',
          exitCode: 0,
        },
      ],
    });

    const result = await factoryReset.invoke(
      { confirm: 'yes delete all my google credentials' },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.state_reset).toBe(true);
    expect(result.data.removed_accounts).toHaveLength(2);
    expect(result.data.removed_accounts.every((a) => a.revoke_ok && a.logout_ok)).toBe(true);

    const reloaded = await loadState();
    expect(reloaded.accounts).toEqual({});
    expect(reloaded.default_account).toBeNull();
  });

  it('continues reset when revokes fail', async () => {
    await writeState({
      state_schema_version: 1,
      default_account: 'alice@example.com',
      accounts: { 'alice@example.com': { read_only: false } },
    });

    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: ['auth', 'revoke', '--account', 'alice@example.com'],
          stderr: 'offline\n',
          exitCode: 2,
        },
        {
          matchArgs: ['auth', 'logout', '--account', 'alice@example.com'],
          stdout: '',
          exitCode: 0,
        },
      ],
    });

    const result = await factoryReset.invoke(
      { confirm: 'yes delete all my google credentials' },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.removed_accounts).toHaveLength(1);
    expect(result.data.removed_accounts[0]?.revoke_ok).toBe(false);
    expect(result.data.removed_accounts[0]?.logout_ok).toBe(true);
    expect(result.data.state_reset).toBe(true);

    const reloaded = await loadState();
    expect(reloaded.accounts).toEqual({});
  });

  it('handles zero-account state gracefully', async () => {
    mock = await installGwsMock({ scenarios: [makeVersionScenario()] });

    const first = await factoryReset.invoke({}, ctx);
    expect(first.ok).toBe(false);
    if (first.ok) throw new Error('unreachable');
    expect(first.error.error_code).toBe('confirmation_required');
    expect(first.error.message).toContain('(0: (none))');

    const second = await factoryReset.invoke(
      { confirm: 'yes delete all my google credentials' },
      ctx,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error('unreachable');
    expect(second.data.removed_accounts).toEqual([]);
    expect(second.data.state_reset).toBe(true);
  });
});
