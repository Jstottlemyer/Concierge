// TDD — T12 shim: drive_files_list.
//
// Written BEFORE the implementation per the plan's TDD mandate. The shim
// wraps `gws drive files list` with:
//   - `max_results` defaulting to 50 and mapping to params.pageSize
//   - `page_token` mapping to params.pageToken
//   - `query`     mapping to params.q
//   - `order_by`, `fields`, `include_shared_drives` passthrough
//   - `extra_params` merged under surfaced fields
//   - output parses the drive.files.list fixture cleanly

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { __resetVersionCacheForTests } from '../../../src/gws/runner.js';
import { GWS_BIN_ENV } from '../../../src/gws/paths.js';
import { installGwsMock, type InstalledGwsMock } from '../../helpers/gws-mock.js';
import {
  makeVersionScenario,
  loadGwsResponseFixture,
} from '../../helpers/gws-mock-scenarios.js';
import { driveFilesList } from '../../../src/tools/shims/drive-files-list.js';
import type { ToolContext } from '../../../src/tools/types.js';

const ctx: ToolContext = { now: '2026-04-13T00:00:00.000Z' };

describe('drive_files_list shim', () => {
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

  it('declares expected tool metadata', () => {
    expect(driveFilesList.name).toBe('drive_files_list');
    expect(driveFilesList.service).toBe('drive');
    expect(driveFilesList.readonly).toBe(true);
    // 3-part description per Decision #13.5 with routing hint to claude.ai.
    expect(driveFilesList.description.toLowerCase()).toContain('use when');
    expect(driveFilesList.description.toLowerCase()).toContain('claude.ai');
    expect(driveFilesList.description.toLowerCase()).toContain('prefer');
  });

  it('lists files on happy path (defaults pageSize=50)', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'drive', 'files', 'list',
            '--format', 'json',
            '--params', JSON.stringify({ pageSize: 50 }),
          ],
          stdout: loadGwsResponseFixture('drive.files.list'),
          exitCode: 0,
        },
      ],
    });

    const result = await driveFilesList.invoke({}, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.files).toHaveLength(2);
    expect(result.data.next_page_token).toBe('~!!~AI9FV7QFAKEPAGETOKEN');
    expect(result.data.has_more).toBe(true);
  });

  it('translates query + max_results + page_token to params.q/pageSize/pageToken', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'drive', 'files', 'list',
            '--format', 'json',
            '--params', JSON.stringify({
              pageSize: 10,
              pageToken: 'abc123',
              q: "name contains 'budget'",
            }),
          ],
          stdout: loadGwsResponseFixture('drive.files.list'),
          exitCode: 0,
        },
      ],
    });

    const result = await driveFilesList.invoke(
      {
        query: "name contains 'budget'",
        max_results: 10,
        page_token: 'abc123',
      },
      ctx,
    );
    expect(result.ok).toBe(true);
  });

  it('sets has_more=false when nextPageToken is empty', async () => {
    const fixture = JSON.parse(loadGwsResponseFixture('drive.files.list')) as {
      files: unknown[];
      nextPageToken: string;
    };
    fixture.nextPageToken = '';
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'drive', 'files', 'list',
            '--format', 'json',
            '--params', JSON.stringify({ pageSize: 50 }),
          ],
          stdout: JSON.stringify(fixture),
          exitCode: 0,
        },
      ],
    });

    const result = await driveFilesList.invoke({}, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.has_more).toBe(false);
  });

  it('rejects invalid max_results via Zod (fractional)', () => {
    const parsed = driveFilesList.input.safeParse({ max_results: 1.5 });
    expect(parsed.success).toBe(false);
  });

  it('rejects max_results above 1000', () => {
    const parsed = driveFilesList.input.safeParse({ max_results: 2000 });
    expect(parsed.success).toBe(false);
  });

  it('returns a gws_error envelope when gws exits non-zero', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'drive', 'files', 'list',
            '--format', 'json',
            '--params', JSON.stringify({ pageSize: 50 }),
          ],
          stderr: 'something broke\n',
          exitCode: 1,
        },
      ],
    });

    const result = await driveFilesList.invoke({}, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('gws_error');
    expect(result.error.gws_stderr).toContain('something broke');
  });

  it('returns a gws_error envelope when stdout is not JSON', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'drive', 'files', 'list',
            '--format', 'json',
            '--params', JSON.stringify({ pageSize: 50 }),
          ],
          stdout: 'not json at all\n',
          exitCode: 0,
        },
      ],
    });

    const result = await driveFilesList.invoke({}, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('gws_error');
  });

  it('passes --account when supplied', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'drive', 'files', 'list',
            '--account', 'alice@example.com',
            '--format', 'json',
            '--params', JSON.stringify({ pageSize: 50 }),
          ],
          stdout: loadGwsResponseFixture('drive.files.list'),
          exitCode: 0,
        },
      ],
    });

    const result = await driveFilesList.invoke(
      { account: 'alice@example.com' },
      ctx,
    );
    expect(result.ok).toBe(true);
  });

  it('merges extra_params under surfaced fields', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'drive', 'files', 'list',
            '--format', 'json',
            '--params', JSON.stringify({
              pageSize: 50,
              spaces: 'drive',
              corpora: 'user',
            }),
          ],
          stdout: loadGwsResponseFixture('drive.files.list'),
          exitCode: 0,
        },
      ],
    });

    const result = await driveFilesList.invoke(
      { extra_params: { spaces: 'drive', corpora: 'user' } },
      ctx,
    );
    expect(result.ok).toBe(true);
  });
});
