// list_accounts (T14) — reads state.json + queries gws per-account for scopes,
// returns connected accounts with their granted bundles and Read-Only flags.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { GWS_BIN_ENV } from '../../../src/gws/paths.js';
import { __resetVersionCacheForTests } from '../../../src/gws/runner.js';
import { __resetCachesForTests as resetGrantedCaches } from '../../../src/auth/granted-bundles.js';
import { listAccounts } from '../../../src/tools/management/list-accounts.js';
import { writeState } from '../../../src/state/loader.js';
import { SERVICE_SCOPES } from '../../../src/bundles/constants.js';
import type { ToolContext } from '../../../src/tools/types.js';
import { installGwsMock, type InstalledGwsMock } from '../../helpers/gws-mock.js';
import { makeVersionScenario } from '../../helpers/gws-mock-scenarios.js';

const ctx: ToolContext = { now: '2026-04-13T00:00:00.000Z' };

let tmpDir: string;
let priorStateEnv: string | undefined;
let priorBinEnv: string | undefined;
let mock: InstalledGwsMock | null = null;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'authtools-mgmt-list-'));
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

describe('list_accounts metadata', () => {
  it('declares expected tool metadata', () => {
    expect(listAccounts.name).toBe('list_accounts');
    expect(listAccounts.service).toBe('management');
    expect(listAccounts.readonly).toBe(true);
    expect(listAccounts.description.toLowerCase()).toContain('use when');
  });
});

describe('list_accounts invocation', () => {
  it('returns empty when state is fresh', async () => {
    mock = await installGwsMock({ scenarios: [makeVersionScenario()] });
    const result = await listAccounts.invoke({}, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.accounts).toEqual([]);
    expect(result.data.default_account).toBeNull();
  });

  it('reports all connected accounts with default flag + read_only + granted bundles', async () => {
    await writeState({
      state_schema_version: 1,
      default_account: 'alice@example.com',
      accounts: {
        'alice@example.com': { read_only: false },
        'bob@example.com': { read_only: true },
      },
    });

    // Productivity bundle services: gmail, drive, calendar, docs, sheets, tasks, forms
    const productivityScopes = [
      ...SERVICE_SCOPES.gmail,
      ...SERVICE_SCOPES.drive,
      ...SERVICE_SCOPES.calendar,
      ...SERVICE_SCOPES.docs,
      ...SERVICE_SCOPES.sheets,
      ...SERVICE_SCOPES.tasks,
      ...SERVICE_SCOPES.forms,
    ];

    // gws v0.22.5 is single-account: `gws auth status` reports the one active
    // user. In this test alice is active; bob is in state.json but not
    // currently authed. listAuthenticatedAccounts still returns both (from
    // state), but only alice's getGrantedBundlesForAccount call finds scopes.
    const authStatusAlice = JSON.stringify({
      user: 'alice@example.com',
      token_valid: true,
      scopes: productivityScopes,
      encrypted_credentials_exists: true,
    });

    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: ['auth', 'status'],
          stdout: `Using keyring backend: keyring\n${authStatusAlice}\n`,
          exitCode: 0,
        },
      ],
      fallbackExitCode: 0,
    });

    const result = await listAccounts.invoke({}, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');

    expect(result.data.default_account).toBe('alice@example.com');
    expect(result.data.accounts).toHaveLength(2);

    const alice = result.data.accounts.find((a) => a.email === 'alice@example.com');
    expect(alice).toBeDefined();
    expect(alice?.is_default).toBe(true);
    expect(alice?.read_only).toBe(false);
    expect(alice?.granted_bundles).toContain('productivity');

    const bob = result.data.accounts.find((a) => a.email === 'bob@example.com');
    expect(bob).toBeDefined();
    expect(bob?.is_default).toBe(false);
    expect(bob?.read_only).toBe(true);
    expect(bob?.granted_bundles).toEqual([]);
  });

  it('rejects extra input fields via strict schema', () => {
    const parsed = listAccounts.input.safeParse({ extra: 'nope' });
    expect(parsed.success).toBe(false);
  });
});
