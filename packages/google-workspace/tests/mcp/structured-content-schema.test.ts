// MCP `structuredContent` ↔ `outputSchema` validation — regression coverage.
//
// Wave 10 note: dispatchToolCall sends SUCCESS data through `structuredContent`
// unwrapped (per MCP spec) but the text-content block wraps it as
// `{ok, data}` for human-readability. A latent bug shipped in v0.1.0 where
// the envelope leaked into `structuredContent`, which Claude Desktop
// rejected as "Tool execution failed" because the wrapper didn't match the
// tool's declared `outputSchema`.
//
// This file adds the regression test that catches that class of bug: for
// each registered zero-input management tool we can drive deterministically,
// install a canned gws mock, invoke through the dispatcher, and assert:
//
//   1. `result.isError === false` — happy path reached.
//   2. `tool.output.safeParse(result.structuredContent).success === true` —
//      the unwrapped payload in `structuredContent` matches the tool's
//      declared outputSchema.
//
// Scope: the three no-input management tools we can exercise without
// business-logic plumbing — `concierge_info`, `concierge_help`,
// `list_accounts`. Tools needing complex inputs (remove_account,
// set_default_account, set_read_only, factory_reset) are covered by their
// own unit tests; this file is specifically about the
// structuredContent/outputSchema contract at the dispatcher layer.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { dispatchToolCall } from '../../src/mcp/dispatch.js';
import { GWS_BIN_ENV } from '../../src/gws/paths.js';
import { __resetVersionCacheForTests } from '../../src/gws/runner.js';
import { __resetCachesForTests as resetGrantedCaches } from '../../src/auth/granted-bundles.js';
import { __resetConciergeInfoCachesForTests } from '../../src/tools/management/concierge-info.js';
import {
  __resetRegistryForTests,
  registerTool,
} from '../../src/tools/registry.js';
import { conciergeInfo } from '../../src/tools/management/concierge-info.js';
import { conciergeHelp } from '../../src/tools/management/concierge-help.js';
import { listAccounts } from '../../src/tools/management/list-accounts.js';
import type { AnyToolDef, ToolContext, ToolDef } from '../../src/tools/types.js';
import { installGwsMock, type InstalledGwsMock, type GwsCallExpectation } from '../helpers/gws-mock.js';
import { makeVersionScenario } from '../helpers/gws-mock-scenarios.js';

const NOW = '2026-04-13T00:00:00.000Z';

function ctx(): ToolContext {
  return { now: NOW };
}

// Zero-input tools we can drive deterministically with a gws mock + empty
// state. Each entry names the tool and a list of additional mock scenarios
// needed beyond the default version probe (so list_accounts, which queries
// gws for authenticated accounts, can add its own).
interface ZeroInputToolCase {
  readonly tool: ToolDef<Record<string, never>, unknown>;
  readonly extraScenarios: readonly GwsCallExpectation[];
}

// `gws auth status` with no stored credentials returns exit code 2 (per
// granted-bundles.ts line 168) which the auth layer treats as "no auth". An
// empty result → `accounts: []`, `default_account: null` — both schema-valid.
const AUTH_STATUS_NO_CREDS: GwsCallExpectation = {
  matchArgs: ['auth', 'status'],
  stdout: '',
  stderr: 'no credentials stored\n',
  exitCode: 2,
};

const ZERO_INPUT_TOOLS: readonly ZeroInputToolCase[] = [
  {
    tool: conciergeInfo as unknown as ToolDef<Record<string, never>, unknown>,
    extraScenarios: [],
  },
  {
    tool: conciergeHelp as unknown as ToolDef<Record<string, never>, unknown>,
    extraScenarios: [],
  },
  {
    tool: listAccounts as unknown as ToolDef<Record<string, never>, unknown>,
    extraScenarios: [AUTH_STATUS_NO_CREDS],
  },
];

describe('structuredContent validates against tool.output schema', () => {
  let tmpDir: string;
  let priorStateEnv: string | undefined;
  let priorBinEnv: string | undefined;
  let mock: InstalledGwsMock | null = null;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'authtools-scc-'));
    priorStateEnv = process.env['CONCIERGE_STATE_DIR'];
    priorBinEnv = process.env[GWS_BIN_ENV];
    process.env['CONCIERGE_STATE_DIR'] = tmpDir;
    __resetVersionCacheForTests();
    __resetConciergeInfoCachesForTests();
    resetGrantedCaches();
    __resetRegistryForTests();
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
    __resetConciergeInfoCachesForTests();
    resetGrantedCaches();
    __resetRegistryForTests();
  });

  for (const { tool, extraScenarios } of ZERO_INPUT_TOOLS) {
    it(`${tool.name}: structuredContent parses through ${tool.name}.output`, async () => {
      mock = await installGwsMock({
        scenarios: [makeVersionScenario(), ...extraScenarios],
      });

      // Register ONLY this tool so dispatch can find it without side effects
      // from other registrations. The real server wires every tool in at
      // bootstrap; tests that target the dispatcher use a minimal registry.
      registerTool(tool as unknown as ToolDef<unknown, unknown>);

      const result = await dispatchToolCall(tool.name, {}, ctx());

      expect(result.isError).toBe(false);
      // Regression-of-record: structuredContent MUST validate against the
      // tool's declared outputSchema. A {ok, data} wrapper or any other
      // envelope leak here is the exact shape v0.1.0's bug produced.
      const parsed = tool.output.safeParse(result.structuredContent);
      if (!parsed.success) {
        // Surface the Zod issue trail on failure so a regression points at
        // the offending field instead of just "safeParse returned false".
        throw new Error(
          `structuredContent for ${tool.name} does not match outputSchema: ` +
            JSON.stringify(parsed.error.issues, null, 2),
        );
      }
      expect(parsed.success).toBe(true);
    });
  }

  it('covers at least every no-input management tool we expect to validate', () => {
    // Guard so a future addition of a zero-input management tool without
    // complex side effects prompts a deliberate update to the coverage list.
    const covered = ZERO_INPUT_TOOLS.map((c) => (c.tool as AnyToolDef).name).sort();
    expect(covered).toEqual(['concierge_help', 'concierge_info', 'list_accounts']);
  });
});
