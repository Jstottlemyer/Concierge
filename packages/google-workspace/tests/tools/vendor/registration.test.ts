// Vendor-helper registration tests — T11.
//
// One consolidated test module that:
//   1. Calls `registerVendorTools()` against a reset registry and asserts all
//      22 tools land with the canonical names from the spec.
//   2. Checks every tool's description passes the Decision #13.5 linter with
//      zero warnings (regressions here tend to be copy-paste slips).
//   3. For each tool, invokes it once through the shared gws mock harness
//      with a minimum-viable input, asserts the child received the expected
//      `[<service>, +<helper>]` argv prefix, and asserts the result is the
//      happy-path `{ok: true, ...}`.
//
// Per-tool input/argv edge cases (multi-recipient CSV joins, boolean flag
// emission, positional file paths) live in `gmail-send.test.ts` and stay out
// of this module so the registration matrix reads at a glance.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { validateDescription } from '../../../src/tools/mcp-schema.js';
import {
  __resetRegistryForTests,
  getAllTools,
  getToolByName,
} from '../../../src/tools/registry.js';
import { registerVendorTools, VENDOR_TOOLS } from '../../../src/tools/vendor/index.js';
import {
  __resetVersionCacheForTests,
} from '../../../src/gws/runner.js';
import { installGwsMock, type InstalledGwsMock } from '../../helpers/gws-mock.js';
import { makeVersionScenario } from '../../helpers/gws-mock-scenarios.js';

// Canonical tool name list from the spec Integration § and plan Decision #13.5.
// Keeping this hand-listed (vs. derived from VENDOR_TOOLS) so a name change
// surfaces as an explicit test diff.
const EXPECTED_TOOL_NAMES = [
  'chat_send',
  'docs_write',
  'drive_upload',
  'events_renew',
  'events_subscribe',
  'gmail_forward',
  'gmail_reply',
  'gmail_reply_all',
  'gmail_send',
  'gmail_triage',
  'gmail_watch',
  'modelarmor_create_template',
  'modelarmor_sanitize_prompt',
  'modelarmor_sanitize_response',
  'script_push',
  'sheets_append',
  'sheets_read',
  'workflow_email_to_task',
  'workflow_file_announce',
  'workflow_meeting_prep',
  'workflow_standup_report',
  'workflow_weekly_digest',
] as const;

/**
 * Minimum-viable input for each tool — enough to pass Zod validation and
 * produce a deterministic argv we can assert against. Values are chosen to
 * avoid `--flag value` emission churn: we only pass required fields.
 */
type InvokeCase = {
  readonly name: string;
  readonly expectedService: string;
  readonly expectedHelper: string;
  readonly input: Readonly<Record<string, unknown>>;
  /** Sample stdout the mock returns for a happy path. */
  readonly mockStdout: string;
  /** When true, `parseOutput: 'raw'` is used — any stdout is acceptable. */
  readonly rawOutput?: boolean;
};

const INVOKE_CASES: readonly InvokeCase[] = [
  {
    name: 'chat_send',
    expectedService: 'chat',
    expectedHelper: '+send',
    input: { space: 'spaces/ABC', text: 'hi' },
    mockStdout: '{"name":"spaces/ABC/messages/1"}',
  },
  {
    name: 'docs_write',
    expectedService: 'docs',
    expectedHelper: '+write',
    input: { document: 'DOC', text: 'hello' },
    mockStdout: '{"documentId":"DOC"}',
  },
  {
    name: 'drive_upload',
    expectedService: 'drive',
    expectedHelper: '+upload',
    input: { file: '/tmp/report.pdf' },
    mockStdout: '{"id":"FILE","name":"report.pdf"}',
  },
  {
    name: 'events_renew',
    expectedService: 'events',
    expectedHelper: '+renew',
    input: { name: 'subscriptions/SUB' },
    mockStdout: '{"name":"subscriptions/SUB","state":"ACTIVE"}',
  },
  {
    name: 'events_subscribe',
    expectedService: 'events',
    expectedHelper: '+subscribe',
    input: { subscription: 'projects/p/subscriptions/s', once: true },
    mockStdout: '{"type":"google.workspace.chat.message.v1.created"}\n',
    rawOutput: true,
  },
  {
    name: 'gmail_forward',
    expectedService: 'gmail',
    expectedHelper: '+forward',
    input: { message_id: 'M1', to: ['a@example.com'] },
    mockStdout: '{"id":"NEW","threadId":"T1"}',
  },
  {
    name: 'gmail_reply',
    expectedService: 'gmail',
    expectedHelper: '+reply',
    input: { message_id: 'M1', body: 'ok' },
    mockStdout: '{"id":"NEW","threadId":"T1"}',
  },
  {
    name: 'gmail_reply_all',
    expectedService: 'gmail',
    expectedHelper: '+reply-all',
    input: { message_id: 'M1', body: 'ok' },
    mockStdout: '{"id":"NEW","threadId":"T1"}',
  },
  {
    name: 'gmail_send',
    expectedService: 'gmail',
    expectedHelper: '+send',
    input: { to: ['a@example.com'], subject: 'hi', body: 'msg' },
    mockStdout: '{"id":"NEW","threadId":"T1","labelIds":["SENT"]}',
  },
  {
    name: 'gmail_triage',
    expectedService: 'gmail',
    expectedHelper: '+triage',
    input: {},
    mockStdout: '[]',
  },
  {
    name: 'gmail_watch',
    expectedService: 'gmail',
    expectedHelper: '+watch',
    input: { project: 'p', once: true },
    mockStdout: '{"emailAddress":"user@example.com"}\n',
    rawOutput: true,
  },
  {
    name: 'modelarmor_create_template',
    expectedService: 'modelarmor',
    expectedHelper: '+create-template',
    input: { project: 'p', location: 'us-central1', template_id: 't' },
    mockStdout: '{"name":"projects/p/locations/us-central1/templates/t"}',
  },
  {
    name: 'modelarmor_sanitize_prompt',
    expectedService: 'modelarmor',
    expectedHelper: '+sanitize-prompt',
    input: {
      template: 'projects/p/locations/us-central1/templates/t',
      text: 'hello',
    },
    mockStdout: '{"filterMatchState":"NO_MATCH_FOUND"}',
  },
  {
    name: 'modelarmor_sanitize_response',
    expectedService: 'modelarmor',
    expectedHelper: '+sanitize-response',
    input: {
      template: 'projects/p/locations/us-central1/templates/t',
      text: 'model reply',
    },
    mockStdout: '{"filterMatchState":"NO_MATCH_FOUND"}',
  },
  {
    name: 'script_push',
    expectedService: 'script',
    expectedHelper: '+push',
    input: { script: 'SCRIPT' },
    mockStdout: '{"scriptId":"SCRIPT"}',
  },
  {
    name: 'sheets_append',
    expectedService: 'sheets',
    expectedHelper: '+append',
    input: { spreadsheet: 'SS', values: ['a', 'b'] },
    mockStdout: '{"spreadsheetId":"SS"}',
  },
  {
    name: 'sheets_read',
    expectedService: 'sheets',
    expectedHelper: '+read',
    input: { spreadsheet: 'SS', range: 'Sheet1!A1:B2' },
    mockStdout: '{"range":"Sheet1!A1:B2","majorDimension":"ROWS","values":[]}',
  },
  {
    name: 'workflow_email_to_task',
    expectedService: 'workflow',
    expectedHelper: '+email-to-task',
    input: { message_id: 'MID' },
    mockStdout: '{"id":"TASK","title":"hi"}',
  },
  {
    name: 'workflow_file_announce',
    expectedService: 'workflow',
    expectedHelper: '+file-announce',
    input: { file_id: 'FILE', space: 'spaces/ABC' },
    mockStdout: '{"name":"spaces/ABC/messages/1"}',
  },
  {
    name: 'workflow_meeting_prep',
    expectedService: 'workflow',
    expectedHelper: '+meeting-prep',
    input: {},
    mockStdout: '{"event":null}',
  },
  {
    name: 'workflow_standup_report',
    expectedService: 'workflow',
    expectedHelper: '+standup-report',
    input: {},
    mockStdout: '{"meetings":[],"tasks":[]}',
  },
  {
    name: 'workflow_weekly_digest',
    expectedService: 'workflow',
    expectedHelper: '+weekly-digest',
    input: {},
    mockStdout: '{"meetings":[],"unreadCount":0}',
  },
];

describe('vendor tool registration (T11)', () => {
  beforeEach(() => {
    __resetRegistryForTests();
  });

  it('exports exactly 22 vendor tools', () => {
    expect(VENDOR_TOOLS).toHaveLength(22);
    expect(EXPECTED_TOOL_NAMES).toHaveLength(22);
  });

  it('registerVendorTools lands every expected tool in the registry', () => {
    registerVendorTools();
    const names = getAllTools().map((t) => t.name).sort();
    expect(names).toEqual([...EXPECTED_TOOL_NAMES].sort());
  });

  it('each registered tool has service + readonly + input + output', () => {
    registerVendorTools();
    for (const name of EXPECTED_TOOL_NAMES) {
      const tool = getToolByName(name);
      expect(tool, `missing tool: ${name}`).toBeDefined();
      if (!tool) continue;
      expect(tool.service).toBeTruthy();
      expect(typeof tool.readonly).toBe('boolean');
      expect(tool.input).toBeTruthy();
      expect(tool.output).toBeTruthy();
    }
  });

  it('every tool description passes the Decision #13.5 linter with zero warnings', () => {
    registerVendorTools();
    const failures: Array<{ name: string; warnings: readonly string[] }> = [];
    for (const tool of getAllTools()) {
      const result = validateDescription(tool.description);
      if (!result.ok) {
        failures.push({ name: tool.name, warnings: result.warnings });
      }
    }
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
  });

  it('readonly flags match the spec (readonly: true for pure reads)', () => {
    registerVendorTools();
    const expectedReadonly = new Set<string>([
      'gmail_triage',
      'gmail_watch',
      'sheets_read',
      'workflow_standup_report',
      'workflow_meeting_prep',
      'workflow_weekly_digest',
      'modelarmor_sanitize_prompt',
      'modelarmor_sanitize_response',
    ]);
    for (const tool of getAllTools()) {
      const expected = expectedReadonly.has(tool.name);
      expect(
        tool.readonly,
        `${tool.name}: expected readonly=${String(expected)}, got ${String(tool.readonly)}`,
      ).toBe(expected);
    }
  });
});

describe('vendor tool happy-path invocation', () => {
  let mock: InstalledGwsMock;

  beforeEach(() => {
    __resetRegistryForTests();
    __resetVersionCacheForTests();
    registerVendorTools();
  });

  afterEach(async () => {
    if (mock !== undefined) {
      await mock.uninstall();
    }
    __resetVersionCacheForTests();
  });

  // Each tool gets its own `it` so a single failure is easy to isolate.
  for (const testCase of INVOKE_CASES) {
    it(`${testCase.name}: invokes gws ${testCase.expectedService} ${testCase.expectedHelper}`, async () => {
      mock = await installGwsMock({
        scenarios: [
          makeVersionScenario(),
          // The mock's in-child matcher is exact argv — so we accept "any" by
          // setting the fallback to a successful response with the expected
          // payload. The actual argv emitted is recorded in `mock.calls` and
          // asserted below.
        ],
        fallbackExitCode: 0,
        fallbackStderr: '',
      });

      // The mock harness only emits stdout for scenarios that exact-match
      // argv. Install a second mock iteration that ALSO matches everything
      // sent to it with the desired stdout — by providing an always-true
      // scenario as a wildcard. Since the harness doesn't support wildcards
      // natively, we rewrite the mock with two installs: one for --version,
      // one for the real call. The mock runner always logs calls regardless
      // of match, so we can read them after.
      await mock.uninstall();
      mock = await installGwsMock({
        scenarios: [makeVersionScenario()],
        fallbackExitCode: 0,
        fallbackStderr: '',
      });

      // Plan B: pre-compute expected argv for the happy-path tool call, add
      // a scenario matching that argv, run the tool, and assert.
      const tool = getToolByName(testCase.name);
      expect(tool, `missing tool: ${testCase.name}`).toBeDefined();
      if (!tool) return;

      // Trick: run invoke once against the version-only mock to discover what
      // argv the tool emits. The runGws runner will call --version first
      // (cached), then try the actual argv — which falls through to the
      // fallback (exitCode 0, empty stdout). The tool surfaces a parse
      // failure but mock.calls records the argv.
      await tool.invoke(testCase.input as never, { now: '2026-04-13T00:00:00Z' });
      const observedArgs = mock.calls
        .map((c) => c.args)
        .filter((a) => !(a.length === 1 && a[0] === '--version'));
      expect(observedArgs.length).toBeGreaterThan(0);
      const firstCall = observedArgs[0];
      expect(firstCall?.[0]).toBe(testCase.expectedService);
      expect(firstCall?.[1]).toBe(testCase.expectedHelper);

      // Now install the REAL scenario with the exact argv we observed and
      // invoke again to verify the happy path round-trips.
      await mock.uninstall();
      __resetVersionCacheForTests();
      mock = await installGwsMock({
        scenarios: [
          makeVersionScenario(),
          {
            matchArgs: firstCall as readonly string[],
            stdout: testCase.mockStdout,
            exitCode: 0,
          },
        ],
      });

      const result = await tool.invoke(testCase.input as never, {
        now: '2026-04-13T00:00:00Z',
      });
      expect(result.ok, JSON.stringify(result)).toBe(true);
    });
  }
});
