// set_default_account (T14) — switches state.default_account.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { setDefaultAccount } from '../../../src/tools/management/set-default-account.js';
import { loadState, writeState } from '../../../src/state/loader.js';
import type { ToolContext } from '../../../src/tools/types.js';

const ctx: ToolContext = { now: '2026-04-13T00:00:00.000Z' };

let tmpDir: string;
let priorStateEnv: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'authtools-mgmt-default-'));
  priorStateEnv = process.env['CONCIERGE_STATE_DIR'];
  process.env['CONCIERGE_STATE_DIR'] = tmpDir;
});

afterEach(async () => {
  if (priorStateEnv === undefined) delete process.env['CONCIERGE_STATE_DIR'];
  else process.env['CONCIERGE_STATE_DIR'] = priorStateEnv;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('set_default_account metadata', () => {
  it('declares expected tool metadata', () => {
    expect(setDefaultAccount.name).toBe('set_default_account');
    expect(setDefaultAccount.service).toBe('management');
    expect(setDefaultAccount.readonly).toBe(false);
  });
});

describe('set_default_account invocation', () => {
  it('updates default_account when target is a connected account', async () => {
    await writeState({
      state_schema_version: 1,
      default_account: 'alice@example.com',
      accounts: {
        'alice@example.com': { read_only: false },
        'bob@example.com': { read_only: false },
      },
    });

    const result = await setDefaultAccount.invoke({ email: 'bob@example.com' }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.default_account).toBe('bob@example.com');

    const reloaded = await loadState();
    expect(reloaded.default_account).toBe('bob@example.com');
  });

  it('rejects when the target is not connected', async () => {
    await writeState({
      state_schema_version: 1,
      default_account: 'alice@example.com',
      accounts: { 'alice@example.com': { read_only: false } },
    });

    const result = await setDefaultAccount.invoke({ email: 'carol@example.com' }, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('validation_error');
    expect(result.error.message).toContain('not connected');

    // State unchanged.
    const reloaded = await loadState();
    expect(reloaded.default_account).toBe('alice@example.com');
  });

  it('normalizes the email to lowercase before lookup', async () => {
    await writeState({
      state_schema_version: 1,
      default_account: null,
      accounts: { 'alice@example.com': { read_only: false } },
    });

    const result = await setDefaultAccount.invoke({ email: 'Alice@Example.COM' }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.default_account).toBe('alice@example.com');
  });

  it('rejects invalid email via Zod', () => {
    const parsed = setDefaultAccount.input.safeParse({ email: 'not-an-email' });
    expect(parsed.success).toBe(false);
  });
});
