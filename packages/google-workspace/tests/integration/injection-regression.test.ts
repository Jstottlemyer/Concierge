// T31 — Prompt-injection regression test (plan Decision #14, spikes.md T0.5/T0.6).
//
// Full end-to-end injection regression requires installing a purpose-built
// .mcpb in Claude Desktop, prompting the model, and scraping the log at
// `/tmp/authtools-injection-log.jsonl`. That is a manual procedure — see
// `docs/setup/injection-regression-check.md` for the checklist. This test
// file performs three machine-checkable things:
//
//   1. Confirm the two spike .mcpb artifacts exist on disk so the manual
//      procedure is actually runnable. If they're missing, fail loudly so
//      the regression cadence doesn't silently degrade.
//   2. Pin the `read_only_active` envelope shape — specifically, its
//      `next_call` must point at `set_read_only` with matching args —
//      because that envelope is one of the surfaces Claude is instructed
//      to follow without user re-confirmation, and an attacker who can
//      coerce a wrong `next_call` tool name could redirect the retry.
//   3. Assert the procedure document exists so `pnpm test` catches
//      accidental deletions.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { accessSync, constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { GWS_BIN_ENV } from '../../src/gws/paths.js';
import { __resetVersionCacheForTests } from '../../src/gws/runner.js';
import { applyReadOnlyMiddleware } from '../../src/tools/middleware/read-only.js';
import {
  __resetRegistryForTests,
  finalizeRegistry,
  getToolByName,
  registerTool,
} from '../../src/tools/registry.js';
import { drivePermissionsCreate } from '../../src/tools/shims/drive-permissions-create.js';
import { writeState } from '../../src/state/loader.js';
import type { ToolContext } from '../../src/tools/types.js';

const SPIKE_DIR = '/tmp/authtools-spikes';
const SPIKE_V3 = path.join(SPIKE_DIR, 'authtools-injection-spike-0.0.3.mcpb');
const SPIKE_V4 = path.join(SPIKE_DIR, 'authtools-injection-spike-0.0.4.mcpb');

// Docs live at the monorepo repo root, not inside the package. Walk up from
// packages/google-workspace/tests/integration/ → four levels.
const DOCS_PATH = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  '..',
  '..',
  '..',
  'docs',
  'setup',
  'injection-regression-check.md',
);

function fileExists(p: string): boolean {
  try {
    accessSync(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

describe('T31 — injection regression artifacts', () => {
  it('documents spike .mcpb artifacts used in Phase 0 T0.5 and T0.6', () => {
    // Historical note: T0.5 used v0.0.3; T0.6 used v0.0.4. Only v0.0.4 was
    // preserved on disk at /tmp/authtools-spikes/ after the spike runs; the
    // v0.0.3 artifact was built then iterated to v0.0.4 in the same
    // workspace. The spikes.md doc records both versions; for regression
    // runs, the v0.0.4 variant covers both (structural + imperative
    // injection) and is the preferred asset.
    const v3Present = fileExists(SPIKE_V3);
    const v4Present = fileExists(SPIKE_V4);

    process.stderr.write(
      `[injection-regression] spike artifacts present: ` +
        `v0.0.3=${String(v3Present)} v0.0.4=${String(v4Present)}\n`,
    );

    // The v0.0.4 asset is the one we actively use; require it.
    expect(v4Present).toBe(true);
  });

  it('procedure documentation exists at docs/setup/injection-regression-check.md', async () => {
    const stat = await fs.stat(DOCS_PATH);
    expect(stat.isFile()).toBe(true);
    // Document should reference the spike artifacts + expected log path.
    const content = await fs.readFile(DOCS_PATH, 'utf8');
    expect(content).toContain('authtools-injection-spike');
    expect(content).toContain('/tmp/authtools-injection-log.jsonl');
    expect(content).toContain('spike_read_email');
  });
});

// --------------------------------------------------------------------------
// read_only_active next_call integrity check
//
// Part of the four-layer defense is that Claude-facing error envelopes do
// NOT become an injection vector themselves. The read_only_active envelope
// carries a `next_call` that Claude may auto-retry against; if that call
// ever pointed somewhere other than `set_read_only` with the right args, an
// attacker who could flip a Read-Only flag could steer Claude to an
// unrelated tool. Pin the shape here so any refactor triggers a red test.
// --------------------------------------------------------------------------

let tmpDir: string;
let priorStateEnv: string | undefined;
let priorBinEnv: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'authtools-injreg-'));
  priorStateEnv = process.env['CONCIERGE_STATE_DIR'];
  priorBinEnv = process.env[GWS_BIN_ENV];
  process.env['CONCIERGE_STATE_DIR'] = tmpDir;
  __resetVersionCacheForTests();
  __resetRegistryForTests();
});

afterEach(async () => {
  if (priorStateEnv === undefined) delete process.env['CONCIERGE_STATE_DIR'];
  else process.env['CONCIERGE_STATE_DIR'] = priorStateEnv;
  if (priorBinEnv === undefined) delete process.env[GWS_BIN_ENV];
  else process.env[GWS_BIN_ENV] = priorBinEnv;
  await fs.rm(tmpDir, { recursive: true, force: true });
  __resetVersionCacheForTests();
  __resetRegistryForTests();
});

describe('T31 — read_only_active envelope next_call integrity', () => {
  it('read_only_active next_call points at set_read_only with the right account and enabled:false', async () => {
    // Seed state with a read_only account.
    const EMAIL = 'alice@example.com';
    await writeState({
      state_schema_version: 1,
      default_account: EMAIL,
      accounts: { [EMAIL]: { read_only: true } },
    });

    // Register a minimal non-readonly tool that accepts { account }.
    // We go through the registry + middleware so the envelope is exactly
    // what users see at runtime.
    registerTool(drivePermissionsCreate);
    applyReadOnlyMiddleware();
    finalizeRegistry();

    const wrapped = getToolByName('drive_permissions_create');
    expect(wrapped).toBeDefined();
    if (wrapped === undefined) throw new Error('unreachable');

    const ctx: ToolContext = { now: '2026-04-13T00:00:00.000Z' };
    // Invoke with all required fields so we pass Zod; the middleware should
    // reject before any gws spawn.
    const result = await wrapped.invoke(
      {
        file_id: 'f',
        email: 'bob@example.com',
        role: 'reader',
        account: EMAIL,
      } as never,
      ctx,
    );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('read_only_active');
    expect(result.error.next_call).toBeDefined();
    expect(result.error.next_call?.tool).toBe('set_read_only');
    expect(result.error.next_call?.arguments).toEqual({
      enabled: false,
      account: EMAIL,
    });
  });
});
