// set_read_only (T14) — toggle-on is immediate; toggle-off requires a
// human-typed confirmation phrase.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { setReadOnly } from '../../../src/tools/management/set-read-only.js';
import { loadState, writeState } from '../../../src/state/loader.js';
import type { ToolContext } from '../../../src/tools/types.js';

const ctx: ToolContext = { now: '2026-04-13T00:00:00.000Z' };

let tmpDir: string;
let priorStateEnv: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'authtools-mgmt-ro-'));
  priorStateEnv = process.env['CONCIERGE_STATE_DIR'];
  process.env['CONCIERGE_STATE_DIR'] = tmpDir;
});

afterEach(async () => {
  if (priorStateEnv === undefined) delete process.env['CONCIERGE_STATE_DIR'];
  else process.env['CONCIERGE_STATE_DIR'] = priorStateEnv;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function seed(): Promise<void> {
  await writeState({
    state_schema_version: 1,
    default_account: 'alice@example.com',
    accounts: {
      'alice@example.com': { read_only: false },
      'bob@example.com': { read_only: true },
    },
  });
}

describe('set_read_only metadata', () => {
  it('declares expected tool metadata', () => {
    expect(setReadOnly.name).toBe('set_read_only');
    expect(setReadOnly.service).toBe('management');
    expect(setReadOnly.readonly).toBe(false);
  });
});

describe('set_read_only toggle-on (enabled: true)', () => {
  it('sets read_only=true without requiring a confirmation phrase', async () => {
    await seed();

    const result = await setReadOnly.invoke(
      { enabled: true, account: 'alice@example.com' },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.account).toBe('alice@example.com');
    expect(result.data.read_only).toBe(true);

    const reloaded = await loadState();
    expect(reloaded.accounts['alice@example.com']?.read_only).toBe(true);
    expect(reloaded.accounts['bob@example.com']?.read_only).toBe(true);
  });

  it('defaults to state.default_account when `account` is omitted', async () => {
    await seed();

    const result = await setReadOnly.invoke({ enabled: true }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.account).toBe('alice@example.com');
    expect(result.data.read_only).toBe(true);
  });

  it('rejects when no default is set and account is omitted', async () => {
    await writeState({
      state_schema_version: 1,
      default_account: null,
      accounts: { 'alice@example.com': { read_only: false } },
    });

    const result = await setReadOnly.invoke({ enabled: true }, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('validation_error');
  });

  it('rejects when target account is not connected', async () => {
    await seed();

    const result = await setReadOnly.invoke(
      { enabled: true, account: 'ghost@example.com' },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('validation_error');
  });
});

describe('set_read_only toggle-off (enabled: false)', () => {
  it('first call without confirm returns confirmation_required with correct next_call', async () => {
    await seed();

    const result = await setReadOnly.invoke(
      { enabled: false, account: 'bob@example.com' },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('confirmation_required');
    expect(result.error.confirmation_phrase).toBe('enable writes for bob@example.com');
    expect(result.error.next_call?.tool).toBe('set_read_only');
    expect(result.error.next_call?.arguments).toEqual({
      account: 'bob@example.com',
      enabled: false,
      confirm: 'enable writes for bob@example.com',
    });

    const reloaded = await loadState();
    expect(reloaded.accounts['bob@example.com']?.read_only).toBe(true);
  });

  it('wrong confirm returns confirmation_mismatch and does not flip', async () => {
    await seed();

    const result = await setReadOnly.invoke(
      {
        enabled: false,
        account: 'bob@example.com',
        confirm: 'enable writes for alice@example.com',
      },
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('confirmation_mismatch');
    expect(result.error.confirmation_phrase).toBe('enable writes for bob@example.com');

    const reloaded = await loadState();
    expect(reloaded.accounts['bob@example.com']?.read_only).toBe(true);
  });

  it('correct confirm flips read_only=false', async () => {
    await seed();

    const result = await setReadOnly.invoke(
      {
        enabled: false,
        account: 'bob@example.com',
        confirm: 'enable writes for bob@example.com',
      },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.account).toBe('bob@example.com');
    expect(result.data.read_only).toBe(false);

    const reloaded = await loadState();
    expect(reloaded.accounts['bob@example.com']?.read_only).toBe(false);
    // Alice unchanged.
    expect(reloaded.accounts['alice@example.com']?.read_only).toBe(false);
  });

  it('toggle-off against default account uses default_account for the phrase', async () => {
    // Put alice in read_only state, keep her as default.
    await writeState({
      state_schema_version: 1,
      default_account: 'alice@example.com',
      accounts: { 'alice@example.com': { read_only: true } },
    });

    const first = await setReadOnly.invoke({ enabled: false }, ctx);
    expect(first.ok).toBe(false);
    if (first.ok) throw new Error('unreachable');
    expect(first.error.confirmation_phrase).toBe('enable writes for alice@example.com');
  });
});
