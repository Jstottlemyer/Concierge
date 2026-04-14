// Read-Only server-side rejection middleware — Wave 7 T17.
//
// Tests are hermetic: every case seeds its own state.json under a fresh tmp
// dir via CONCIERGE_STATE_DIR. The registry is reset between cases so
// applyReadOnlyMiddleware doesn't leak state across tests.
//
// We avoid invoking any real gws-backed tool; we synthesize tiny test fixture
// tools with trivial invoke bodies and count calls to assert that rejection
// short-circuits before the underlying invoke runs.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { z } from 'zod/v3';

import { writeState } from '../../../src/state/loader.js';
import {
  __isWrappedForTests,
  applyReadOnlyMiddleware,
  enforceReadOnly,
  resolveEffectiveAccount,
} from '../../../src/tools/middleware/read-only.js';
import {
  __resetRegistryForTests,
  getToolByName,
  registerTool,
} from '../../../src/tools/registry.js';
import type { ToolContext, ToolDef, ToolResult } from '../../../src/tools/types.js';

const CTX: ToolContext = { now: '2026-04-13T00:00:00.000Z' };

let tmpDir: string;
let priorStateEnv: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'authtools-ro-mw-'));
  priorStateEnv = process.env['CONCIERGE_STATE_DIR'];
  process.env['CONCIERGE_STATE_DIR'] = tmpDir;
  __resetRegistryForTests();
});

afterEach(async () => {
  if (priorStateEnv === undefined) delete process.env['CONCIERGE_STATE_DIR'];
  else process.env['CONCIERGE_STATE_DIR'] = priorStateEnv;
  await fs.rm(tmpDir, { recursive: true, force: true });
  __resetRegistryForTests();
});

/** Build a minimal non-readonly tool that accepts { account?: string } and
 *  records each invocation in `calls`. */
function makeWriteTool(
  name: string,
  calls: Array<{ account?: string | undefined }>,
): ToolDef<{ account?: string | undefined }, { ok: true }> {
  return {
    name,
    description:
      'Test write tool. Use in middleware tests to verify rejection. For real behavior, prefer any other tool.',
    service: 'management',
    readonly: false,
    input: z.object({ account: z.string().optional() }),
    output: z.object({ ok: z.literal(true) }),
    invoke: async (args): Promise<ToolResult<{ ok: true }>> => {
      calls.push({ account: args.account });
      return { ok: true, data: { ok: true } };
    },
  };
}

/** Build a readonly tool — declared-safe regardless of state. */
function makeReadTool(
  name: string,
  calls: Array<Record<string, never>>,
): ToolDef<Record<string, never>, { ok: true }> {
  return {
    name,
    description:
      'Test readonly tool. Use in middleware tests. For real behavior, prefer any other tool.',
    service: 'management',
    readonly: true,
    input: z.object({}).strict(),
    output: z.object({ ok: z.literal(true) }),
    invoke: async (): Promise<ToolResult<{ ok: true }>> => {
      calls.push({});
      return { ok: true, data: { ok: true } };
    },
  };
}

/** Build a stand-in for gws_execute with the exact name the middleware keys
 *  off of, and the caller-asserted `readonly` field. */
function makeGwsExecuteStub(
  calls: Array<{ readonly: boolean; account?: string | undefined }>,
): ToolDef<{ readonly: boolean; account?: string | undefined }, { ok: true }> {
  return {
    name: 'gws_execute',
    description:
      'Stub for gws_execute in middleware tests. Use when exercising caller-asserted readonly. For real behavior, prefer typed tools.',
    service: 'passthrough',
    readonly: false,
    input: z.object({ readonly: z.boolean(), account: z.string().optional() }),
    output: z.object({ ok: z.literal(true) }),
    invoke: async (args): Promise<ToolResult<{ ok: true }>> => {
      calls.push({ readonly: args.readonly, account: args.account });
      return { ok: true, data: { ok: true } };
    },
  };
}

async function seedState(
  opts: { default?: string | null; accounts: Record<string, { read_only: boolean }> },
): Promise<void> {
  await writeState({
    state_schema_version: 1,
    default_account: opts.default ?? null,
    accounts: opts.accounts,
  });
}

describe('enforceReadOnly — readonly tool', () => {
  it('always allows (no state lookup needed)', async () => {
    const calls: Array<Record<string, never>> = [];
    const tool = makeReadTool('list_something', calls);
    const wrapped = enforceReadOnly(tool);

    // Even with no state.json at all, readonly tool runs.
    const result = await wrapped.invoke({}, CTX);
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('runs when account is in read-only mode', async () => {
    await seedState({
      default: 'alice@example.com',
      accounts: { 'alice@example.com': { read_only: true } },
    });
    const calls: Array<Record<string, never>> = [];
    const tool = makeReadTool('list_something', calls);
    const wrapped = enforceReadOnly(tool);

    const result = await wrapped.invoke({}, CTX);
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe('enforceReadOnly — non-readonly tool', () => {
  it('runs when state has read_only === false for the account', async () => {
    await seedState({
      default: 'alice@example.com',
      accounts: { 'alice@example.com': { read_only: false } },
    });
    const calls: Array<{ account?: string | undefined }> = [];
    const tool = makeWriteTool('send_something', calls);
    const wrapped = enforceReadOnly(tool);

    const result = await wrapped.invoke({}, CTX);
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('rejects with read_only_active envelope when account is read-only', async () => {
    await seedState({
      default: 'alice@example.com',
      accounts: { 'alice@example.com': { read_only: true } },
    });
    const calls: Array<{ account?: string | undefined }> = [];
    const tool = makeWriteTool('send_something', calls);
    const wrapped = enforceReadOnly(tool);

    const result = await wrapped.invoke({}, CTX);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('read_only_active');
    expect(result.error.message).toContain('alice@example.com');
    expect(result.error.message).toContain('send_something');
    expect(result.error.next_call).toEqual({
      tool: 'set_read_only',
      arguments: { enabled: false, account: 'alice@example.com' },
    });
    // The underlying tool MUST NOT have been called.
    expect(calls).toHaveLength(0);
  });

  it('uses args.account when provided (overrides default)', async () => {
    await seedState({
      default: 'alice@example.com',
      accounts: {
        'alice@example.com': { read_only: false },
        'bob@example.com': { read_only: true },
      },
    });
    const calls: Array<{ account?: string | undefined }> = [];
    const tool = makeWriteTool('send_something', calls);
    const wrapped = enforceReadOnly(tool);

    const result = await wrapped.invoke({ account: 'bob@example.com' }, CTX);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('read_only_active');
    expect(result.error.message).toContain('bob@example.com');
    expect(calls).toHaveLength(0);
  });

  it('normalizes email case when looking up state', async () => {
    await seedState({
      default: 'alice@example.com',
      accounts: { 'alice@example.com': { read_only: true } },
    });
    const calls: Array<{ account?: string | undefined }> = [];
    const tool = makeWriteTool('send_something', calls);
    const wrapped = enforceReadOnly(tool);

    // Upper-case input should still resolve to alice@example.com.
    const result = await wrapped.invoke({ account: 'ALICE@Example.com' }, CTX);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('read_only_active');
    expect(result.error.message).toContain('alice@example.com');
  });

  it('allows when account is unknown (no state entry) — defers to underlying tool', async () => {
    await seedState({
      default: 'alice@example.com',
      accounts: { 'alice@example.com': { read_only: true } },
    });
    const calls: Array<{ account?: string | undefined }> = [];
    const tool = makeWriteTool('send_something', calls);
    const wrapped = enforceReadOnly(tool);

    // carol isn't in state; middleware treats unknown account as not read-only
    // and hands off to the tool, which owns "account not connected" errors.
    const result = await wrapped.invoke({ account: 'carol@example.com' }, CTX);
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });
});

describe('enforceReadOnly — gws_execute', () => {
  it('allows when args.readonly === true even if account is read-only', async () => {
    await seedState({
      default: 'alice@example.com',
      accounts: { 'alice@example.com': { read_only: true } },
    });
    const calls: Array<{ readonly: boolean; account?: string | undefined }> = [];
    const tool = makeGwsExecuteStub(calls);
    const wrapped = enforceReadOnly(tool);

    const result = await wrapped.invoke({ readonly: true }, CTX);
    expect(result.ok).toBe(true);
    expect(calls).toEqual([{ readonly: true, account: undefined }]);
  });

  it('rejects when args.readonly === false and account is read-only', async () => {
    await seedState({
      default: 'alice@example.com',
      accounts: { 'alice@example.com': { read_only: true } },
    });
    const calls: Array<{ readonly: boolean; account?: string | undefined }> = [];
    const tool = makeGwsExecuteStub(calls);
    const wrapped = enforceReadOnly(tool);

    const result = await wrapped.invoke({ readonly: false }, CTX);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('read_only_active');
    expect(result.error.message).toContain('gws_execute');
    expect(calls).toHaveLength(0);
  });

  it('runs when args.readonly === false but account is NOT read-only', async () => {
    await seedState({
      default: 'alice@example.com',
      accounts: { 'alice@example.com': { read_only: false } },
    });
    const calls: Array<{ readonly: boolean; account?: string | undefined }> = [];
    const tool = makeGwsExecuteStub(calls);
    const wrapped = enforceReadOnly(tool);

    const result = await wrapped.invoke({ readonly: false }, CTX);
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('honors args.account over default_account for the state lookup', async () => {
    await seedState({
      default: 'alice@example.com',
      accounts: {
        'alice@example.com': { read_only: false },
        'bob@example.com': { read_only: true },
      },
    });
    const calls: Array<{ readonly: boolean; account?: string | undefined }> = [];
    const tool = makeGwsExecuteStub(calls);
    const wrapped = enforceReadOnly(tool);

    const result = await wrapped.invoke({ readonly: false, account: 'bob@example.com' }, CTX);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('read_only_active');
    expect(result.error.message).toContain('bob@example.com');
  });
});

describe('resolveEffectiveAccount', () => {
  it('prefers args.account when non-empty', async () => {
    await seedState({
      default: 'alice@example.com',
      accounts: { 'alice@example.com': { read_only: false } },
    });
    expect(await resolveEffectiveAccount({ account: 'bob@example.com' })).toBe(
      'bob@example.com',
    );
  });

  it('falls back to state.default_account when args.account is absent', async () => {
    await seedState({
      default: 'alice@example.com',
      accounts: { 'alice@example.com': { read_only: false } },
    });
    expect(await resolveEffectiveAccount({})).toBe('alice@example.com');
    expect(await resolveEffectiveAccount(undefined)).toBe('alice@example.com');
  });

  it('returns null when no default and no args.account', async () => {
    await seedState({ default: null, accounts: {} });
    expect(await resolveEffectiveAccount({})).toBeNull();
    expect(await resolveEffectiveAccount(undefined)).toBeNull();
  });

  it('ignores empty-string args.account (falls through to default)', async () => {
    await seedState({
      default: 'alice@example.com',
      accounts: { 'alice@example.com': { read_only: false } },
    });
    expect(await resolveEffectiveAccount({ account: '' })).toBe('alice@example.com');
    expect(await resolveEffectiveAccount({ account: '   ' })).toBe('alice@example.com');
  });

  it('lowercases args.account so state lookups are consistent', async () => {
    expect(await resolveEffectiveAccount({ account: 'ALICE@Example.com' })).toBe(
      'alice@example.com',
    );
  });
});

describe('applyReadOnlyMiddleware', () => {
  it('wraps every registered tool in place', async () => {
    const writeCalls: Array<{ account?: string | undefined }> = [];
    const readCalls: Array<Record<string, never>> = [];
    registerTool(makeWriteTool('write_a', writeCalls));
    registerTool(makeReadTool('read_b', readCalls));

    applyReadOnlyMiddleware();

    const writeA = getToolByName('write_a');
    const readB = getToolByName('read_b');
    expect(writeA).toBeDefined();
    expect(readB).toBeDefined();
    if (writeA === undefined || readB === undefined) throw new Error('unreachable');

    expect(__isWrappedForTests(writeA)).toBe(true);
    expect(__isWrappedForTests(readB)).toBe(true);

    // Sanity: the wrapped write tool actually enforces Read-Only.
    await seedState({
      default: 'alice@example.com',
      accounts: { 'alice@example.com': { read_only: true } },
    });
    const result = await (writeA.invoke as (
      args: { account?: string | undefined },
      ctx: ToolContext,
    ) => Promise<ToolResult<unknown>>)({}, CTX);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('read_only_active');
    expect(writeCalls).toHaveLength(0);
  });

  it('is idempotent — calling twice does not double-wrap', async () => {
    const writeCalls: Array<{ account?: string | undefined }> = [];
    registerTool(makeWriteTool('write_a', writeCalls));

    applyReadOnlyMiddleware();
    const afterFirst = getToolByName('write_a');
    expect(afterFirst).toBeDefined();
    if (afterFirst === undefined) throw new Error('unreachable');
    const firstRef = afterFirst;

    applyReadOnlyMiddleware();
    const afterSecond = getToolByName('write_a');
    expect(afterSecond).toBeDefined();
    if (afterSecond === undefined) throw new Error('unreachable');

    // Same wrapped reference survives — not re-wrapped.
    expect(afterSecond).toBe(firstRef);
    expect(__isWrappedForTests(afterSecond)).toBe(true);

    // And still enforces behavior correctly.
    await seedState({
      default: 'alice@example.com',
      accounts: { 'alice@example.com': { read_only: true } },
    });
    const result = await (afterSecond.invoke as (
      args: { account?: string | undefined },
      ctx: ToolContext,
    ) => Promise<ToolResult<unknown>>)({}, CTX);
    expect(result.ok).toBe(false);
    expect(writeCalls).toHaveLength(0);
  });
});
