// TDD — T12 shim: drive_files_download.
//
// Wraps `gws drive files get` with `alt=media`. The fixture is metadata
// (drive.files.get.json) but the API contract is: when `alt=media`, the body
// is raw bytes. For Concierge' MCP surface we hand the caller back the
// metadata (which gws --format json emits) because returning raw bytes
// through MCP is awkward. If you need actual bytes, use claude.ai's hosted
// Drive connector — that's the point of the routing hint.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { __resetVersionCacheForTests } from '../../../src/gws/runner.js';
import { GWS_BIN_ENV } from '../../../src/gws/paths.js';
import { installGwsMock, type InstalledGwsMock } from '../../helpers/gws-mock.js';
import {
  makeVersionScenario,
  loadGwsResponseFixture,
} from '../../helpers/gws-mock-scenarios.js';
import { driveFilesDownload } from '../../../src/tools/shims/drive-files-download.js';
import type { ToolContext } from '../../../src/tools/types.js';

const ctx: ToolContext = { now: '2026-04-13T00:00:00.000Z' };

describe('drive_files_download shim', () => {
  const priorBin = process.env[GWS_BIN_ENV];
  let mock: InstalledGwsMock | null = null;

  beforeEach(() => { __resetVersionCacheForTests(); });
  afterEach(async () => {
    if (mock !== null) { await mock.uninstall(); mock = null; }
    __resetVersionCacheForTests();
    if (priorBin === undefined) delete process.env[GWS_BIN_ENV];
    else process.env[GWS_BIN_ENV] = priorBin;
  });

  it('metadata advertises readonly + routing hint', () => {
    expect(driveFilesDownload.name).toBe('drive_files_download');
    expect(driveFilesDownload.readonly).toBe(true);
    expect(driveFilesDownload.description.toLowerCase()).toContain('claude.ai');
    expect(driveFilesDownload.description.toLowerCase()).toContain('prefer');
  });

  it('happy path — returns file metadata from gws stdout', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'drive', 'files', 'get',
            '--format', 'json',
            '--params', JSON.stringify({
              fileId: '1FAKE_FILE_ID_ABCDEFGHIJKLMNOPQRSTUV',
              alt: 'media',
            }),
          ],
          stdout: loadGwsResponseFixture('drive.files.get'),
          exitCode: 0,
        },
      ],
    });

    const result = await driveFilesDownload.invoke(
      { file_id: '1FAKE_FILE_ID_ABCDEFGHIJKLMNOPQRSTUV' },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.id).toBe('1FAKE_FILE_ID_ABCDEFGHIJKLMNOPQRSTUV');
    expect(result.data.name).toBe('Sample Document.docx');
  });

  it('rejects empty file_id', () => {
    expect(driveFilesDownload.input.safeParse({ file_id: '' }).success).toBe(false);
    expect(driveFilesDownload.input.safeParse({}).success).toBe(false);
  });

  it('surfaces gws errors via the envelope', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'drive', 'files', 'get',
            '--format', 'json',
            '--params', JSON.stringify({ fileId: 'bad', alt: 'media' }),
          ],
          stderr: 'not found\n',
          exitCode: 1,
        },
      ],
    });

    const result = await driveFilesDownload.invoke({ file_id: 'bad' }, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.error_code).toBe('gws_error');
  });
});
