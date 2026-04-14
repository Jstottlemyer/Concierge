// gmail_send targeted tests — T11.
//
// Covers the per-tool details the consolidated registration suite skips:
//   - Input-schema rejection of invalid emails / missing required fields.
//   - CSV-join of multi-recipient to/cc/bcc arrays.
//   - Repeated --attach emission for array inputs.
//   - Boolean flag emission (html, draft, dry_run).
//   - --account pass-through.
//   - extra_params escape hatch: arbitrary key/value pairs tack onto argv.
//   - Failure-path handling: non-zero gws exit surfaces an error envelope with
//     the expected error_code and gws_exit_code metadata.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { gmailSend } from '../../../src/tools/vendor/gmail-send.js';
import {
  __resetVersionCacheForTests,
} from '../../../src/gws/runner.js';
import { installGwsMock, type InstalledGwsMock } from '../../helpers/gws-mock.js';
import { makeVersionScenario } from '../../helpers/gws-mock-scenarios.js';

const CTX = { now: '2026-04-13T00:00:00Z' } as const;

describe('gmail_send input schema', () => {
  it('rejects empty to[]', async () => {
    const parsed = gmailSend.input.safeParse({
      to: [],
      subject: 'hi',
      body: 'msg',
    });
    expect(parsed.success).toBe(false);
  });

  it('rejects invalid email addresses', async () => {
    const parsed = gmailSend.input.safeParse({
      to: ['not-an-email'],
      subject: 'hi',
      body: 'msg',
    });
    expect(parsed.success).toBe(false);
  });

  it('requires subject + body + to', async () => {
    expect(gmailSend.input.safeParse({ to: ['a@x.com'], subject: 'hi' }).success).toBe(false);
    expect(gmailSend.input.safeParse({ to: ['a@x.com'], body: 'b' }).success).toBe(false);
    expect(gmailSend.input.safeParse({ subject: 'hi', body: 'b' }).success).toBe(false);
  });

  it('accepts the minimal happy path', () => {
    const parsed = gmailSend.input.safeParse({
      to: ['a@example.com'],
      subject: 'hi',
      body: 'msg',
    });
    expect(parsed.success).toBe(true);
  });
});

describe('gmail_send argv construction', () => {
  let mock: InstalledGwsMock;

  beforeEach(async () => {
    __resetVersionCacheForTests();
  });

  afterEach(async () => {
    if (mock !== undefined) await mock.uninstall();
    __resetVersionCacheForTests();
  });

  it('joins multi-recipient to/cc/bcc on commas and repeats --attach', async () => {
    mock = await installGwsMock({
      scenarios: [makeVersionScenario()],
      fallbackExitCode: 0,
      fallbackStderr: '',
    });

    await gmailSend.invoke(
      {
        to: ['a@example.com', 'b@example.com'],
        subject: 'hi',
        body: 'msg',
        cc: ['c@example.com'],
        bcc: ['d@example.com', 'e@example.com'],
        attach: ['/tmp/a.pdf', '/tmp/b.csv'],
        html: true,
        draft: true,
        dry_run: true,
        from: 'alias@example.com',
        account: 'me@example.com',
        extra_params: { sanitize: 'projects/P/locations/L/templates/T' },
      },
      CTX,
    );

    const nonVersion = mock.calls
      .map((c) => c.args)
      .filter((a) => !(a.length === 1 && a[0] === '--version'));
    expect(nonVersion).toHaveLength(1);
    const args = nonVersion[0] ?? [];

    // service + helper come first.
    expect(args.slice(0, 2)).toEqual(['gmail', '+send']);

    // required flags carry CSV-joined addresses.
    expect(args).toContain('--to');
    const toIdx = args.indexOf('--to');
    expect(args[toIdx + 1]).toBe('a@example.com,b@example.com');

    expect(args).toContain('--cc');
    expect(args[args.indexOf('--cc') + 1]).toBe('c@example.com');

    expect(args).toContain('--bcc');
    expect(args[args.indexOf('--bcc') + 1]).toBe('d@example.com,e@example.com');

    // --attach repeats for each entry.
    const attachCount = args.filter((a) => a === '--attach').length;
    expect(attachCount).toBe(2);

    // Boolean presence flags.
    expect(args).toContain('--html');
    expect(args).toContain('--draft');
    expect(args).toContain('--dry-run');

    // Alias + account.
    expect(args).toContain('--from');
    expect(args[args.indexOf('--from') + 1]).toBe('alias@example.com');
    expect(args).toContain('--account');
    expect(args[args.indexOf('--account') + 1]).toBe('me@example.com');

    // extra_params escape hatch.
    expect(args).toContain('--sanitize');
    expect(args[args.indexOf('--sanitize') + 1]).toBe(
      'projects/P/locations/L/templates/T',
    );

    // --format json is always emitted (we fix it to get parseable stdout).
    expect(args).toContain('--format');
    expect(args[args.indexOf('--format') + 1]).toBe('json');
  });

  it('omits optional flags when they are undefined', async () => {
    mock = await installGwsMock({
      scenarios: [makeVersionScenario()],
      fallbackExitCode: 0,
      fallbackStderr: '',
    });

    await gmailSend.invoke(
      {
        to: ['a@example.com'],
        subject: 'hi',
        body: 'msg',
      },
      CTX,
    );

    const nonVersion = mock.calls
      .map((c) => c.args)
      .filter((a) => !(a.length === 1 && a[0] === '--version'));
    const args = nonVersion[0] ?? [];
    expect(args).not.toContain('--html');
    expect(args).not.toContain('--draft');
    expect(args).not.toContain('--dry-run');
    expect(args).not.toContain('--cc');
    expect(args).not.toContain('--bcc');
    expect(args).not.toContain('--attach');
    expect(args).not.toContain('--from');
    expect(args).not.toContain('--account');
  });
});

describe('gmail_send result handling', () => {
  let mock: InstalledGwsMock;

  beforeEach(() => {
    __resetVersionCacheForTests();
  });

  afterEach(async () => {
    if (mock !== undefined) await mock.uninstall();
    __resetVersionCacheForTests();
  });

  it('happy path: parses stdout JSON into the output schema', async () => {
    // Install a mock that replies with the canonical send response. We use
    // the fallback branch for the actual gmail +send call since the argv is
    // long and exact-matching it in this test would duplicate the argv-
    // construction test above. We set fallbackExitCode to 0 and emit the
    // real stdout via a second install after we know the argv.
    mock = await installGwsMock({
      scenarios: [makeVersionScenario()],
      fallbackExitCode: 0,
      fallbackStderr: '',
    });

    // First call discovers argv (fallback produces empty stdout -> parse
    // fails -> ok: false, but mock.calls is populated).
    await gmailSend.invoke(
      { to: ['a@example.com'], subject: 'hi', body: 'msg' },
      CTX,
    );
    const observed = mock.calls
      .map((c) => c.args)
      .filter((a) => !(a.length === 1 && a[0] === '--version'))[0];
    expect(observed).toBeDefined();
    if (!observed) return;

    await mock.uninstall();
    __resetVersionCacheForTests();
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: observed,
          stdout: '{"id":"NEW_MSG","threadId":"T1","labelIds":["SENT"]}',
          exitCode: 0,
        },
      ],
    });

    const result = await gmailSend.invoke(
      { to: ['a@example.com'], subject: 'hi', body: 'msg' },
      CTX,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.id).toBe('NEW_MSG');
    expect(result.data.threadId).toBe('T1');
    expect(result.data.labelIds).toEqual(['SENT']);
  });

  it('non-zero exit: returns an error envelope with gws_error_code', async () => {
    // Any argv miss → fallback with exitCode 1 → toolErrorFromGwsResult maps
    // exit 1 to gws_error.
    mock = await installGwsMock({
      scenarios: [makeVersionScenario()],
      fallbackExitCode: 1,
      fallbackStderr: 'gws: transient upstream failure\n',
    });

    const result = await gmailSend.invoke(
      { to: ['a@example.com'], subject: 'hi', body: 'msg' },
      CTX,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.error_code).toBe('gws_error');
    expect(result.error.gws_exit_code).toBe(1);
    expect(result.error.gws_stderr).toContain('transient upstream failure');
  });

  it('non-JSON stdout: surfaces a gws_error with a parse diagnostic', async () => {
    mock = await installGwsMock({
      scenarios: [makeVersionScenario()],
      fallbackExitCode: 0,
      fallbackStderr: '',
    });

    // Fallback stdout is '' — JSON.parse('') throws. Result should be
    // { ok: false, error: gws_error } with a message mentioning the parse
    // failure.
    const result = await gmailSend.invoke(
      { to: ['a@example.com'], subject: 'hi', body: 'msg' },
      CTX,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.error_code).toBe('gws_error');
    expect(result.error.message).toMatch(/non-JSON|schema/i);
  });
});
