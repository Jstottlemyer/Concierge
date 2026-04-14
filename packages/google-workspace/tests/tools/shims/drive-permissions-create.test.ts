// TDD — T12 shim: drive_permissions_create.
//
// Covers plan Decision #3 (cross-domain confirmation) and Open Q#3 (phrase is
// `share with <target_email>`, per the canonical table in
// src/confirmation/phrases.ts).
//
// Cross-domain logic (same-domain vs cross-domain) uses:
//   - `args.account` if supplied as the source email.
//   - Otherwise the state.json `default_account`.
//   - Target is the email in the permission request body.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { __resetVersionCacheForTests } from '../../../src/gws/runner.js';
import { GWS_BIN_ENV } from '../../../src/gws/paths.js';
import { installGwsMock, type InstalledGwsMock } from '../../helpers/gws-mock.js';
import {
  makeVersionScenario,
  loadGwsResponseFixture,
} from '../../helpers/gws-mock-scenarios.js';
import { drivePermissionsCreate } from '../../../src/tools/shims/drive-permissions-create.js';
import type { ToolContext } from '../../../src/tools/types.js';

const ctx: ToolContext = { now: '2026-04-13T00:00:00.000Z' };

function setupStateDir(defaultAccount: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'authtools-state-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'state.json'),
    JSON.stringify({
      state_schema_version: 1,
      default_account: defaultAccount,
      accounts: { [defaultAccount]: { read_only: false } },
    }),
    { mode: 0o600 },
  );
  return dir;
}

describe('drive_permissions_create shim', () => {
  const priorBin = process.env[GWS_BIN_ENV];
  const priorStateDir = process.env['CONCIERGE_STATE_DIR'];
  let mock: InstalledGwsMock | null = null;
  let stateDir: string | null = null;

  beforeEach(() => { __resetVersionCacheForTests(); });
  afterEach(async () => {
    if (mock !== null) { await mock.uninstall(); mock = null; }
    __resetVersionCacheForTests();
    if (priorBin === undefined) delete process.env[GWS_BIN_ENV];
    else process.env[GWS_BIN_ENV] = priorBin;
    if (stateDir !== null) {
      rmSync(stateDir, { recursive: true, force: true });
      stateDir = null;
    }
    if (priorStateDir === undefined) delete process.env['CONCIERGE_STATE_DIR'];
    else process.env['CONCIERGE_STATE_DIR'] = priorStateDir;
  });

  it('metadata — write tool, no routing hint', () => {
    expect(drivePermissionsCreate.name).toBe('drive_permissions_create');
    expect(drivePermissionsCreate.readonly).toBe(false);
    expect(drivePermissionsCreate.service).toBe('drive');
    expect(drivePermissionsCreate.description.toLowerCase()).toContain('use when');
  });

  it('same-domain — no confirmation required', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'drive', 'permissions', 'create',
            '--account', 'alice@example.com',
            '--format', 'json',
            '--params', JSON.stringify({
              fileId: 'FAKE_FILE_1',
              sendNotificationEmail: true,
            }),
            '--json', JSON.stringify({
              role: 'writer',
              type: 'user',
              emailAddress: 'bob@example.com',
            }),
          ],
          stdout: loadGwsResponseFixture('drive.permissions.create'),
          exitCode: 0,
        },
      ],
    });

    const result = await drivePermissionsCreate.invoke(
      {
        file_id: 'FAKE_FILE_1',
        email: 'bob@example.com',
        role: 'writer',
        account: 'alice@example.com',
      },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.id).toBe('08FAKEPERMISSIONID');
  });

  it('cross-domain without confirm — returns confirmation_required envelope', async () => {
    // No gws call should be made — install scenario that would fail the test
    // if called.
    mock = await installGwsMock({
      scenarios: [makeVersionScenario()],
    });

    const result = await drivePermissionsCreate.invoke(
      {
        file_id: 'FAKE_FILE_1',
        email: 'external@other-domain.com',
        role: 'reader',
        account: 'alice@example.com',
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('confirmation_required');
    expect(result.error.confirmation_phrase).toBe('share with external@other-domain.com');
    expect(result.error.next_call?.tool).toBe('drive_permissions_create');
    expect(result.error.next_call?.arguments['confirm']).toBe('share with external@other-domain.com');
    // Critically: gws was NOT invoked for the permission call (only --version).
    expect(mock.calls.filter((c) => c.args[0] !== '--version')).toHaveLength(0);
  });

  it('cross-domain with WRONG confirm — confirmation_mismatch, no gws call', async () => {
    mock = await installGwsMock({
      scenarios: [makeVersionScenario()],
    });

    const result = await drivePermissionsCreate.invoke(
      {
        file_id: 'FAKE_FILE_1',
        email: 'external@other-domain.com',
        role: 'reader',
        account: 'alice@example.com',
        confirm: 'share with the wrong person',
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('confirmation_mismatch');
    expect(result.error.confirmation_phrase).toBe('share with external@other-domain.com');
    expect(mock.calls.filter((c) => c.args[0] !== '--version')).toHaveLength(0);
  });

  it('cross-domain with correct confirm — proceeds to gws', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'drive', 'permissions', 'create',
            '--account', 'alice@example.com',
            '--format', 'json',
            '--params', JSON.stringify({
              fileId: 'FAKE_FILE_1',
              sendNotificationEmail: true,
            }),
            '--json', JSON.stringify({
              role: 'reader',
              type: 'user',
              emailAddress: 'external@other-domain.com',
            }),
          ],
          stdout: loadGwsResponseFixture('drive.permissions.create'),
          exitCode: 0,
        },
      ],
    });

    const result = await drivePermissionsCreate.invoke(
      {
        file_id: 'FAKE_FILE_1',
        email: 'external@other-domain.com',
        role: 'reader',
        account: 'alice@example.com',
        confirm: 'share with external@other-domain.com',
      },
      ctx,
    );
    expect(result.ok).toBe(true);
  });

  it('uses state.default_account as source when account not provided', async () => {
    stateDir = setupStateDir('default-user@example.com');
    process.env['CONCIERGE_STATE_DIR'] = stateDir;

    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'drive', 'permissions', 'create',
            '--format', 'json',
            '--params', JSON.stringify({
              fileId: 'FAKE_FILE_1',
              sendNotificationEmail: true,
            }),
            '--json', JSON.stringify({
              role: 'writer',
              type: 'user',
              emailAddress: 'teammate@example.com',
            }),
          ],
          stdout: loadGwsResponseFixture('drive.permissions.create'),
          exitCode: 0,
        },
      ],
    });

    const result = await drivePermissionsCreate.invoke(
      {
        file_id: 'FAKE_FILE_1',
        email: 'teammate@example.com',
        role: 'writer',
      },
      ctx,
    );
    expect(result.ok).toBe(true);
  });

  it('rejects missing file_id / email via Zod', () => {
    expect(drivePermissionsCreate.input.safeParse({ email: 'a@b.com', role: 'writer' }).success).toBe(false);
    expect(drivePermissionsCreate.input.safeParse({ file_id: 'x', role: 'writer' }).success).toBe(false);
    expect(drivePermissionsCreate.input.safeParse({ file_id: 'x', email: 'bad', role: 'writer' }).success).toBe(false);
  });

  it('rejects invalid role values', () => {
    expect(drivePermissionsCreate.input.safeParse({
      file_id: 'x', email: 'a@b.com', role: 'pharaoh',
    }).success).toBe(false);
  });
});
