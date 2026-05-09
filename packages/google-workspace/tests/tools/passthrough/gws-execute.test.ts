// T13 passthrough tool — `gws_execute` tests.
//
// Coverage goals (per the task scope):
//   - Registration: name, service tag, description passes the Decision #13.5
//     linter with zero warnings.
//   - Input validation: bad service / resource / method patterns, flag-prefix
//     values in extra_params, denylisted extra_params keys — each rejected
//     with a validation_error envelope (not a thrown exception).
//   - Argv shape: happy path builds the expected `[service, resource, method,
//     --format, json, --params, <json>, --json, <json>]` vector and the mock
//     sees that argv verbatim.
//   - Subprocess behavior: nonzero exit maps via `toolErrorFromGwsResult`;
//     exit-3 (gws's own validation rejection) surfaces as `validation_error`.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  __resetRegistryForTests,
  getAllTools,
  getToolByName,
} from '../../../src/tools/registry.js';
import { validateDescription } from '../../../src/tools/mcp-schema.js';
import { __resetVersionCacheForTests } from '../../../src/gws/runner.js';
import { GWS_BIN_ENV } from '../../../src/gws/paths.js';
import {
  registerPassthroughTools,
  PASSTHROUGH_TOOLS,
  gwsExecute,
} from '../../../src/tools/passthrough/index.js';
import {
  buildPassthroughArgv,
  type GwsExecuteInput,
} from '../../../src/tools/passthrough/gws-execute.js';
import { installGwsMock, type InstalledGwsMock } from '../../helpers/gws-mock.js';
import {
  makeVersionScenario,
  loadGwsResponseFixture,
} from '../../helpers/gws-mock-scenarios.js';
import type { ToolContext } from '../../../src/tools/types.js';

const ctx: ToolContext = { now: '2026-04-13T00:00:00.000Z' };

/** Shortcut for a syntactically-valid happy-path input. */
function baseInput(overrides: Partial<GwsExecuteInput> = {}): GwsExecuteInput {
  return {
    service: 'drive',
    resource: 'files',
    method: 'list',
    readonly: true,
    ...overrides,
  } as GwsExecuteInput;
}

describe('gws_execute — registration', () => {
  beforeEach(() => {
    __resetRegistryForTests();
  });

  it('registerPassthroughTools lands exactly the gws_execute tool', () => {
    expect(PASSTHROUGH_TOOLS).toHaveLength(1);
    registerPassthroughTools();
    const names = getAllTools().map((t) => t.name);
    expect(names).toEqual(['gws_execute']);
  });

  it('exposes service=passthrough and readonly=false (registry flag)', () => {
    registerPassthroughTools();
    const tool = getToolByName('gws_execute');
    expect(tool).toBeDefined();
    if (!tool) return;
    expect(tool.service).toBe('passthrough');
    expect(tool.readonly).toBe(false);
  });

  it('description passes the Decision #13.5 linter with zero warnings', () => {
    const result = validateDescription(gwsExecute.description);
    expect(result.warnings, JSON.stringify(result.warnings)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('input schema requires service/resource/method/readonly', () => {
    const missingService = gwsExecute.input.safeParse({
      resource: 'files',
      method: 'list',
      readonly: true,
    });
    expect(missingService.success).toBe(false);

    const missingReadonly = gwsExecute.input.safeParse({
      service: 'drive',
      resource: 'files',
      method: 'list',
    });
    expect(missingReadonly.success).toBe(false);

    const ok = gwsExecute.input.safeParse(baseInput());
    expect(ok.success).toBe(true);
  });
});

describe('gws_execute — input validation', () => {
  it('rejects uppercase service name at the schema boundary', () => {
    const parsed = gwsExecute.input.safeParse(baseInput({ service: 'Drive' }));
    expect(parsed.success).toBe(false);
  });

  it('rejects resource name with a leading digit', () => {
    const parsed = gwsExecute.input.safeParse(baseInput({ resource: '1files' }));
    expect(parsed.success).toBe(false);
  });

  it('rejects method name with a shell metacharacter', () => {
    const parsed = gwsExecute.input.safeParse(baseInput({ method: 'list;rm' }));
    expect(parsed.success).toBe(false);
  });

  it('rejects account that is not an email', () => {
    const parsed = gwsExecute.input.safeParse(baseInput({ account: 'not-an-email' }));
    expect(parsed.success).toBe(false);
  });

  it('rejects denylisted extra_params key: credentials', async () => {
    const result = await gwsExecute.invoke(
      baseInput({ extra_params: { credentials: '/tmp/evil.json' } }),
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.error_code).toBe('validation_error');
    expect(result.error.message.toLowerCase()).toContain('denylisted');
  });

  it('rejects denylisted extra_params key: config', async () => {
    const result = await gwsExecute.invoke(
      baseInput({ extra_params: { config: '/etc/passwd' } }),
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.error_code).toBe('validation_error');
  });

  it('rejects denylisted extra_params key: auth-override', async () => {
    const result = await gwsExecute.invoke(
      baseInput({ extra_params: { 'auth-override': 'hostile' } }),
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.error_code).toBe('validation_error');
  });

  it('rejects denylisted extra_params key even when prefixed with --', async () => {
    const result = await gwsExecute.invoke(
      baseInput({ extra_params: { '--credentials': 'boom' } }),
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.error_code).toBe('validation_error');
  });

  it('rejects flag-prefixed values in extra_params', async () => {
    const result = await gwsExecute.invoke(
      baseInput({ extra_params: { fancy: '--evil' } }),
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.error_code).toBe('validation_error');
  });

  it('rejects a denylisted extra_params value (e.g. --credentials as value)', async () => {
    const result = await gwsExecute.invoke(
      baseInput({ extra_params: { somekey: '--credentials' } }),
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.error_code).toBe('validation_error');
  });

  it('rejects flag-prefixed upload path', async () => {
    const result = await gwsExecute.invoke(
      baseInput({ upload: '--wicked' }),
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.error_code).toBe('validation_error');
  });
});

describe('gws_execute — argv construction (pure)', () => {
  it('emits [service, resource, method, --format, json] with no params', () => {
    const argv = buildPassthroughArgv(baseInput());
    expect(argv).toEqual(['drive', 'files', 'list', '--format', 'json']);
  });

  it('inlines params as a JSON string after --params', () => {
    const argv = buildPassthroughArgv(
      baseInput({ params: { pageSize: 10, q: "name = 'x'" } }),
    );
    expect(argv).toContain('--params');
    const idx = argv.indexOf('--params');
    expect(argv[idx + 1]).toBe(JSON.stringify({ pageSize: 10, q: "name = 'x'" }));
  });

  it('inlines body as a JSON string after --json', () => {
    const argv = buildPassthroughArgv(
      baseInput({ method: 'create', readonly: false, body: { title: 'Hi' } }),
    );
    expect(argv).toContain('--json');
    const idx = argv.indexOf('--json');
    expect(argv[idx + 1]).toBe(JSON.stringify({ title: 'Hi' }));
  });

  it('emits --account <email> when supplied', () => {
    const argv = buildPassthroughArgv(
      baseInput({ account: 'alice@example.com' }),
    );
    expect(argv).toContain('--account');
    const idx = argv.indexOf('--account');
    expect(argv[idx + 1]).toBe('alice@example.com');
  });

  it('emits --upload <path> when supplied', () => {
    const argv = buildPassthroughArgv(
      baseInput({ upload: '/tmp/image.png' }),
    );
    expect(argv).toContain('--upload');
    const idx = argv.indexOf('--upload');
    expect(argv[idx + 1]).toBe('/tmp/image.png');
  });

  it('appends extra_params as --<key> <value> pairs', () => {
    const argv = buildPassthroughArgv(
      baseInput({ extra_params: { spaces: 'drive', corpora: 'user' } }),
    );
    expect(argv).toContain('--spaces');
    expect(argv).toContain('drive');
    expect(argv).toContain('--corpora');
    expect(argv).toContain('user');
  });

  it('expands a dotted resource path into separate argv segments', () => {
    const argv = buildPassthroughArgv(
      baseInput({
        service: 'gmail',
        resource: 'users.messages',
        method: 'trash',
        readonly: false,
        params: { userId: 'me', id: 'abc123' },
      }),
    );
    // gws gmail users messages trash --format json --params <json>
    expect(argv.slice(0, 5)).toEqual(['gmail', 'users', 'messages', 'trash', '--format']);
    expect(argv).toContain('--params');
    const idx = argv.indexOf('--params');
    expect(argv[idx + 1]).toBe(JSON.stringify({ userId: 'me', id: 'abc123' }));
  });

  it('expands users.threads into 4-level argv', () => {
    const argv = buildPassthroughArgv(
      baseInput({
        service: 'gmail',
        resource: 'users.threads',
        method: 'trash',
        readonly: false,
        params: { userId: 'me', id: 'tid-1' },
      }),
    );
    expect(argv.slice(0, 4)).toEqual(['gmail', 'users', 'threads', 'trash']);
  });

  it('expands users.labels for label list', () => {
    const argv = buildPassthroughArgv(
      baseInput({
        service: 'gmail',
        resource: 'users.labels',
        method: 'list',
        params: { userId: 'me' },
      }),
    );
    expect(argv.slice(0, 4)).toEqual(['gmail', 'users', 'labels', 'list']);
  });

  it('expands a 3-segment dotted path (e.g. users.messages.attachments)', () => {
    const argv = buildPassthroughArgv(
      baseInput({
        service: 'gmail',
        resource: 'users.messages.attachments',
        method: 'get',
        params: { userId: 'me', messageId: 'm1', id: 'a1' },
      }),
    );
    expect(argv.slice(0, 5)).toEqual([
      'gmail',
      'users',
      'messages',
      'attachments',
      'get',
    ]);
  });

  it('preserves single-segment behavior (no regression for drive/files/list)', () => {
    const argv = buildPassthroughArgv(baseInput());
    expect(argv).toEqual(['drive', 'files', 'list', '--format', 'json']);
  });
});

describe('gws_execute — dotted resource path schema', () => {
  it('schema accepts users.messages', () => {
    const parsed = gwsExecute.input.safeParse(
      baseInput({
        service: 'gmail',
        resource: 'users.messages',
        method: 'trash',
        readonly: false,
      }),
    );
    expect(parsed.success).toBe(true);
  });

  it('schema rejects users..messages (empty middle segment)', () => {
    const parsed = gwsExecute.input.safeParse(
      baseInput({ resource: 'users..messages' }),
    );
    expect(parsed.success).toBe(false);
  });

  it('schema rejects trailing dot', () => {
    const parsed = gwsExecute.input.safeParse(baseInput({ resource: 'users.' }));
    expect(parsed.success).toBe(false);
  });

  it('schema rejects leading dot', () => {
    const parsed = gwsExecute.input.safeParse(baseInput({ resource: '.users' }));
    expect(parsed.success).toBe(false);
  });

  it('schema rejects uppercase nested segment', () => {
    const parsed = gwsExecute.input.safeParse(
      baseInput({ resource: 'users.Messages' }),
    );
    expect(parsed.success).toBe(false);
  });
});

describe('gws_execute — subprocess invocation', () => {
  const priorBin = process.env[GWS_BIN_ENV];
  let mock: InstalledGwsMock | null = null;

  beforeEach(() => {
    __resetVersionCacheForTests();
  });

  afterEach(async () => {
    if (mock !== null) {
      await mock.uninstall();
      mock = null;
    }
    __resetVersionCacheForTests();
    if (priorBin === undefined) delete process.env[GWS_BIN_ENV];
    else process.env[GWS_BIN_ENV] = priorBin;
  });

  it('happy path: drive/files/list routes through gws and returns parsed JSON', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'drive', 'files', 'list',
            '--format', 'json',
            '--params', JSON.stringify({ pageSize: 10 }),
          ],
          stdout: loadGwsResponseFixture('drive.files.list'),
          exitCode: 0,
        },
      ],
    });

    const result = await gwsExecute.invoke(
      baseInput({ params: { pageSize: 10 } }),
      ctx,
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;

    // The fixture is a Drive files.list response — assert on a field we know
    // exists without pinning the whole shape.
    const data = result.data as { files?: unknown[] };
    expect(Array.isArray(data.files)).toBe(true);
  });

  it('params + body: argv carries both --params and --json', async () => {
    const body = { title: 'Scratch' };
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'docs', 'documents', 'create',
            '--format', 'json',
            '--params', JSON.stringify({}),
            '--json', JSON.stringify(body),
          ],
          stdout: loadGwsResponseFixture('docs.documents.create'),
          exitCode: 0,
        },
      ],
    });

    const result = await gwsExecute.invoke(
      baseInput({
        service: 'docs',
        resource: 'documents',
        method: 'create',
        readonly: false,
        params: {},
        body,
      }),
      ctx,
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });

  it('nonzero exit (1) maps to gws_error envelope', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: ['drive', 'files', 'list', '--format', 'json'],
          stderr: 'boom\n',
          exitCode: 1,
        },
      ],
    });

    const result = await gwsExecute.invoke(baseInput(), ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.error_code).toBe('gws_error');
    expect(result.error.gws_exit_code).toBe(1);
    expect(result.error.gws_stderr).toContain('boom');
  });

  it('gws exit code 3 (argument validation) maps to validation_error envelope', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: ['drive', 'files', 'notamethod', '--format', 'json'],
          stderr: 'unknown method: notamethod\n',
          exitCode: 3,
        },
      ],
    });

    const result = await gwsExecute.invoke(
      baseInput({ method: 'notamethod' }),
      ctx,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.error_code).toBe('validation_error');
    expect(result.error.gws_exit_code).toBe(3);
  });

  it('returns gws_error when stdout is not JSON', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: ['drive', 'files', 'list', '--format', 'json'],
          stdout: 'not json\n',
          exitCode: 0,
        },
      ],
    });

    const result = await gwsExecute.invoke(baseInput(), ctx);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.error_code).toBe('gws_error');
  });

  it('gmail users.messages trash routes through 4-level argv and returns parsed JSON', async () => {
    const trashed = '{"id":"19e0da5ee5070cef","labelIds":["TRASH"]}';
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'gmail',
            'users',
            'messages',
            'trash',
            '--format',
            'json',
            '--params',
            JSON.stringify({ userId: 'me', id: '19e0da5ee5070cef' }),
          ],
          stdout: trashed,
          exitCode: 0,
        },
      ],
    });

    const result = await gwsExecute.invoke(
      baseInput({
        service: 'gmail',
        resource: 'users.messages',
        method: 'trash',
        readonly: false,
        params: { userId: 'me', id: '19e0da5ee5070cef' },
      }),
      ctx,
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    const data = result.data as { labelIds?: string[] };
    expect(data.labelIds).toContain('TRASH');
  });

  it('gmail users.messages get works via 4-level argv', async () => {
    const messageJson = '{"id":"m1","payload":{"body":{"data":"SGVsbG8="}}}';
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'gmail',
            'users',
            'messages',
            'get',
            '--format',
            'json',
            '--params',
            JSON.stringify({ userId: 'me', id: 'm1', format: 'full' }),
          ],
          stdout: messageJson,
          exitCode: 0,
        },
      ],
    });

    const result = await gwsExecute.invoke(
      baseInput({
        service: 'gmail',
        resource: 'users.messages',
        method: 'get',
        readonly: true,
        params: { userId: 'me', id: 'm1', format: 'full' },
      }),
      ctx,
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    const data = result.data as { payload?: { body?: { data?: string } } };
    expect(data.payload?.body?.data).toBe('SGVsbG8=');
  });

  it('gmail users.threads trash works via 4-level argv', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'gmail',
            'users',
            'threads',
            'trash',
            '--format',
            'json',
            '--params',
            JSON.stringify({ userId: 'me', id: 't1' }),
          ],
          stdout: '{"id":"t1"}',
          exitCode: 0,
        },
      ],
    });

    const result = await gwsExecute.invoke(
      baseInput({
        service: 'gmail',
        resource: 'users.threads',
        method: 'trash',
        readonly: false,
        params: { userId: 'me', id: 't1' },
      }),
      ctx,
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
  });

  it('gmail users.labels list works via 4-level argv', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'gmail',
            'users',
            'labels',
            'list',
            '--format',
            'json',
            '--params',
            JSON.stringify({ userId: 'me' }),
          ],
          stdout: '{"labels":[{"id":"INBOX","name":"INBOX"}]}',
          exitCode: 0,
        },
      ],
    });

    const result = await gwsExecute.invoke(
      baseInput({
        service: 'gmail',
        resource: 'users.labels',
        method: 'list',
        readonly: true,
        params: { userId: 'me' },
      }),
      ctx,
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    const data = result.data as { labels?: { id: string }[] };
    expect(data.labels?.[0]?.id).toBe('INBOX');
  });

  it('returns ok with null data when stdout is empty (side-effect call)', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: ['drive', 'files', 'delete', '--format', 'json'],
          stdout: '',
          exitCode: 0,
        },
      ],
    });

    const result = await gwsExecute.invoke(
      baseInput({ method: 'delete', readonly: false }),
      ctx,
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.data).toBeNull();
  });
});
