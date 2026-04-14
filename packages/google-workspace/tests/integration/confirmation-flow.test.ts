// T31 — Confirmation-phrase E2E + exact-match enforcement across the four
// destructive ops (AC §17, plan Decision #5 + spec §Destructive operations).
//
// For each destructive op we run three scenarios end-to-end through the tool
// invoke path — not the phrase-table primitives directly — so regressions in
// the warning message, the response envelope, or the `next_call` routing get
// caught here rather than only in the phrase-unit test.
//
// Destructive ops under test:
//   1. remove_account(email)                → `remove <email>`
//   2. factory_reset()                      → `yes delete all my google credentials`
//   3. set_read_only(enabled: false, account) → `enable writes for <account>`
//   4. drive_permissions_create cross-domain → `share with <target_email>`
//
// Scenario matrix per op:
//   - First call WITHOUT `confirm` → `confirmation_required` envelope with
//     the canonical phrase + next_call pointed at the right tool with the
//     confirm key already filled in.
//   - Wrong `confirm` variants (lowercase, extra whitespace that does NOT
//     normalize to the canonical, close-but-not-exact) → `confirmation_mismatch`
//     envelope; nothing mutates.
//   - Correct `confirm` → the tool executes its real path.
//
// AC §17 response shape:
//   - `error_code`: 'confirmation_required' | 'confirmation_mismatch'
//   - `message`: non-empty user-facing warning / instruction
//   - `confirmation_phrase`: the canonical phrase (present on both variants)
//   - `next_call`: present on 'confirmation_required' with the retry argv

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { GWS_BIN_ENV } from '../../src/gws/paths.js';
import { __resetVersionCacheForTests } from '../../src/gws/runner.js';
import { __resetCachesForTests as resetGrantedCaches } from '../../src/auth/granted-bundles.js';
import { factoryReset } from '../../src/tools/management/factory-reset.js';
import { removeAccount } from '../../src/tools/management/remove-account.js';
import { setReadOnly } from '../../src/tools/management/set-read-only.js';
import { drivePermissionsCreate } from '../../src/tools/shims/drive-permissions-create.js';
import { loadState, writeState } from '../../src/state/loader.js';
import type { ToolContext } from '../../src/tools/types.js';
import {
  installGwsMock,
  type InstalledGwsMock,
} from '../helpers/gws-mock.js';
import {
  loadGwsResponseFixture,
  makeVersionScenario,
} from '../helpers/gws-mock-scenarios.js';

const ctx: ToolContext = { now: '2026-04-13T00:00:00.000Z' };

let tmpDir: string;
let priorStateEnv: string | undefined;
let priorBinEnv: string | undefined;
let mock: InstalledGwsMock | null = null;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'authtools-confirm-flow-'));
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

async function seedAccount(email: string, readOnly = false): Promise<void> {
  await writeState({
    state_schema_version: 1,
    default_account: email,
    accounts: { [email]: { read_only: readOnly } },
  });
}

describe('remove_account — confirmation phrase E2E', () => {
  const EMAIL = 'alice@example.com';
  const PHRASE = `remove ${EMAIL}`;

  it('first call without confirm → confirmation_required envelope with canonical phrase + next_call', async () => {
    await seedAccount(EMAIL);
    mock = await installGwsMock({ scenarios: [makeVersionScenario()] });

    const result = await removeAccount.invoke({ email: EMAIL }, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('confirmation_required');
    expect(result.error.confirmation_phrase).toBe(PHRASE);
    expect(result.error.next_call).toEqual({
      tool: 'remove_account',
      arguments: { email: EMAIL, confirm: PHRASE },
    });
    // AC §17 requires a non-empty user-facing message.
    expect(result.error.message.length).toBeGreaterThan(0);
    expect(result.error.message).toContain(EMAIL);
  });

  it('wrong-case confirm → confirmation_mismatch (case sensitive)', async () => {
    await seedAccount(EMAIL);
    mock = await installGwsMock({ scenarios: [makeVersionScenario()] });

    const result = await removeAccount.invoke(
      { email: EMAIL, confirm: 'REMOVE alice@example.com' },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('confirmation_mismatch');
    expect(result.error.confirmation_phrase).toBe(PHRASE);

    // Account still connected.
    const s = await loadState();
    expect(s.accounts[EMAIL]).toBeDefined();
  });

  it('close-but-not-exact confirm → confirmation_mismatch', async () => {
    await seedAccount(EMAIL);
    mock = await installGwsMock({ scenarios: [makeVersionScenario()] });

    const result = await removeAccount.invoke(
      { email: EMAIL, confirm: 'remove alice@example.com please' },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('confirmation_mismatch');
  });

  it('canonical confirm → tool proceeds with revoke + logout + state mutation', async () => {
    await seedAccount(EMAIL);
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        { matchArgs: ['auth', 'revoke', '--account', EMAIL], exitCode: 0 },
        { matchArgs: ['auth', 'logout', '--account', EMAIL], exitCode: 0 },
      ],
    });

    const result = await removeAccount.invoke({ email: EMAIL, confirm: PHRASE }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.removed_email).toBe(EMAIL);

    const s = await loadState();
    expect(s.accounts[EMAIL]).toBeUndefined();
  });
});

describe('factory_reset — confirmation phrase E2E', () => {
  const PHRASE = 'yes delete all my google credentials';

  it('first call without confirm → confirmation_required envelope with canonical phrase + next_call', async () => {
    await writeState({
      state_schema_version: 1,
      default_account: null,
      accounts: {},
    });
    mock = await installGwsMock({ scenarios: [makeVersionScenario()] });

    const result = await factoryReset.invoke({}, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('confirmation_required');
    expect(result.error.confirmation_phrase).toBe(PHRASE);
    expect(result.error.next_call).toEqual({
      tool: 'factory_reset',
      arguments: { confirm: PHRASE },
    });
    expect(result.error.message.length).toBeGreaterThan(0);
  });

  it('wrong-case confirm → confirmation_mismatch', async () => {
    await writeState({
      state_schema_version: 1,
      default_account: null,
      accounts: {},
    });
    mock = await installGwsMock({ scenarios: [makeVersionScenario()] });

    const result = await factoryReset.invoke(
      { confirm: 'Yes Delete All My Google Credentials' },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('confirmation_mismatch');
    expect(result.error.confirmation_phrase).toBe(PHRASE);
  });

  it('close-but-not-exact confirm → confirmation_mismatch (missing final word)', async () => {
    await writeState({
      state_schema_version: 1,
      default_account: null,
      accounts: {},
    });
    mock = await installGwsMock({ scenarios: [makeVersionScenario()] });

    const result = await factoryReset.invoke(
      { confirm: 'yes delete all my google' },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('confirmation_mismatch');
  });

  it('canonical confirm → tool proceeds and resets state', async () => {
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
          exitCode: 0,
        },
        {
          matchArgs: ['auth', 'logout', '--account', 'alice@example.com'],
          exitCode: 0,
        },
      ],
    });

    const result = await factoryReset.invoke({ confirm: PHRASE }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.state_reset).toBe(true);

    const s = await loadState();
    expect(s.accounts).toEqual({});
    expect(s.default_account).toBeNull();
  });
});

describe('set_read_only (toggle-off) — confirmation phrase E2E', () => {
  const EMAIL = 'alice@example.com';
  const PHRASE = `enable writes for ${EMAIL}`;

  it('first call without confirm → confirmation_required with canonical phrase + next_call', async () => {
    await seedAccount(EMAIL, /*readOnly*/ true);

    const result = await setReadOnly.invoke(
      { enabled: false, account: EMAIL },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('confirmation_required');
    expect(result.error.confirmation_phrase).toBe(PHRASE);
    expect(result.error.next_call).toEqual({
      tool: 'set_read_only',
      arguments: { account: EMAIL, enabled: false, confirm: PHRASE },
    });
    expect(result.error.message.length).toBeGreaterThan(0);
  });

  it('wrong-case confirm → confirmation_mismatch', async () => {
    await seedAccount(EMAIL, true);
    const result = await setReadOnly.invoke(
      {
        enabled: false,
        account: EMAIL,
        confirm: 'Enable Writes For alice@example.com',
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('confirmation_mismatch');
    // State unchanged.
    const s = await loadState();
    expect(s.accounts[EMAIL]?.read_only).toBe(true);
  });

  it('close-but-not-exact confirm (wrong email) → confirmation_mismatch', async () => {
    await seedAccount(EMAIL, true);
    const result = await setReadOnly.invoke(
      {
        enabled: false,
        account: EMAIL,
        confirm: 'enable writes for bob@example.com',
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('confirmation_mismatch');
    expect(result.error.confirmation_phrase).toBe(PHRASE);
  });

  it('canonical confirm → flag flips to false', async () => {
    await seedAccount(EMAIL, true);
    const result = await setReadOnly.invoke(
      { enabled: false, account: EMAIL, confirm: PHRASE },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.read_only).toBe(false);

    const s = await loadState();
    expect(s.accounts[EMAIL]?.read_only).toBe(false);
  });
});

describe('drive_permissions_create (cross-domain) — confirmation phrase E2E', () => {
  const ACCOUNT = 'alice@example.com';
  const TARGET = 'carol@outside.org';
  const PHRASE = `share with ${TARGET}`;

  it('first call without confirm → confirmation_required with canonical phrase + next_call', async () => {
    await seedAccount(ACCOUNT);
    mock = await installGwsMock({ scenarios: [makeVersionScenario()] });

    const result = await drivePermissionsCreate.invoke(
      {
        file_id: 'file-abc',
        email: TARGET,
        role: 'reader',
        account: ACCOUNT,
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('confirmation_required');
    expect(result.error.confirmation_phrase).toBe(PHRASE);
    expect(result.error.next_call?.tool).toBe('drive_permissions_create');
    expect(result.error.next_call?.arguments['email']).toBe(TARGET);
    expect(result.error.next_call?.arguments['confirm']).toBe(PHRASE);
  });

  it('wrong-case confirm → confirmation_mismatch', async () => {
    await seedAccount(ACCOUNT);
    mock = await installGwsMock({ scenarios: [makeVersionScenario()] });

    const result = await drivePermissionsCreate.invoke(
      {
        file_id: 'file-abc',
        email: TARGET,
        role: 'reader',
        account: ACCOUNT,
        confirm: 'Share With carol@outside.org',
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('confirmation_mismatch');
  });

  it('wrong-target confirm → confirmation_mismatch', async () => {
    await seedAccount(ACCOUNT);
    mock = await installGwsMock({ scenarios: [makeVersionScenario()] });

    const result = await drivePermissionsCreate.invoke(
      {
        file_id: 'file-abc',
        email: TARGET,
        role: 'reader',
        account: ACCOUNT,
        confirm: 'share with other@outside.org',
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('confirmation_mismatch');
    expect(result.error.confirmation_phrase).toBe(PHRASE);
  });

  it('canonical confirm → shim proceeds to gws', async () => {
    await seedAccount(ACCOUNT);
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'drive', 'permissions', 'create',
            '--account', ACCOUNT,
            '--format', 'json',
            '--params', JSON.stringify({
              fileId: 'file-abc',
              sendNotificationEmail: true,
            }),
            '--json', JSON.stringify({
              role: 'reader',
              type: 'user',
              emailAddress: TARGET,
            }),
          ],
          stdout: loadGwsResponseFixture('drive.permissions.create'),
          exitCode: 0,
        },
      ],
    });

    const result = await drivePermissionsCreate.invoke(
      {
        file_id: 'file-abc',
        email: TARGET,
        role: 'reader',
        account: ACCOUNT,
        confirm: PHRASE,
      },
      ctx,
    );
    expect(result.ok).toBe(true);
  });
});

describe('AC §17 response shape audit', () => {
  it('confirmation_required envelopes always carry error_code + message + confirmation_phrase + next_call', async () => {
    await writeState({
      state_schema_version: 1,
      default_account: null,
      accounts: {},
    });
    mock = await installGwsMock({ scenarios: [makeVersionScenario()] });

    const env = await factoryReset.invoke({}, ctx);
    expect(env.ok).toBe(false);
    if (env.ok) throw new Error('unreachable');
    expect(env.error.error_code).toBe('confirmation_required');
    expect(typeof env.error.message).toBe('string');
    expect(env.error.message.length).toBeGreaterThan(0);
    expect(typeof env.error.confirmation_phrase).toBe('string');
    expect(env.error.next_call).toBeDefined();
    expect(env.error.next_call?.tool).toBe('factory_reset');
    expect(env.error.next_call?.arguments['confirm']).toBe(env.error.confirmation_phrase);
  });

  it('confirmation_mismatch envelopes carry error_code + message + confirmation_phrase for retry guidance', async () => {
    await writeState({
      state_schema_version: 1,
      default_account: null,
      accounts: {},
    });
    mock = await installGwsMock({ scenarios: [makeVersionScenario()] });

    const env = await factoryReset.invoke({ confirm: 'nope' }, ctx);
    expect(env.ok).toBe(false);
    if (env.ok) throw new Error('unreachable');
    expect(env.error.error_code).toBe('confirmation_mismatch');
    expect(typeof env.error.confirmation_phrase).toBe('string');
    expect(env.error.confirmation_phrase?.length).toBeGreaterThan(0);
    expect(env.error.message).toContain(env.error.confirmation_phrase ?? '');
  });
});
