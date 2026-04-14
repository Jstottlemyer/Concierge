// TDD — T12 shim: sheets_spreadsheets_create.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { __resetVersionCacheForTests } from '../../../src/gws/runner.js';
import { GWS_BIN_ENV } from '../../../src/gws/paths.js';
import { installGwsMock, type InstalledGwsMock } from '../../helpers/gws-mock.js';
import {
  makeVersionScenario,
  loadGwsResponseFixture,
} from '../../helpers/gws-mock-scenarios.js';
import { sheetsSpreadsheetsCreate } from '../../../src/tools/shims/sheets-spreadsheets-create.js';
import type { ToolContext } from '../../../src/tools/types.js';

const ctx: ToolContext = { now: '2026-04-13T00:00:00.000Z' };

describe('sheets_spreadsheets_create shim', () => {
  const priorBin = process.env[GWS_BIN_ENV];
  let mock: InstalledGwsMock | null = null;
  beforeEach(() => { __resetVersionCacheForTests(); });
  afterEach(async () => {
    if (mock !== null) { await mock.uninstall(); mock = null; }
    __resetVersionCacheForTests();
    if (priorBin === undefined) delete process.env[GWS_BIN_ENV];
    else process.env[GWS_BIN_ENV] = priorBin;
  });

  it('is write + sheets service', () => {
    expect(sheetsSpreadsheetsCreate.readonly).toBe(false);
    expect(sheetsSpreadsheetsCreate.service).toBe('sheets');
  });

  it('creates with minimal title', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'sheets', 'spreadsheets', 'create',
            '--format', 'json',
            '--params', JSON.stringify({}),
            '--json', JSON.stringify({ properties: { title: 'Concierge Scratch Sheet' } }),
          ],
          stdout: loadGwsResponseFixture('sheets.spreadsheets.create'),
          exitCode: 0,
        },
      ],
    });
    const result = await sheetsSpreadsheetsCreate.invoke(
      { title: 'Concierge Scratch Sheet' },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('x');
    expect(result.data.spreadsheetId).toBe('1FAKE_SHEET_ID_ABCDEFGHIJKLMNOPQRSTUV');
    expect(result.data.spreadsheetUrl).toContain('docs.google.com');
  });

  it('rejects empty title', () => {
    expect(sheetsSpreadsheetsCreate.input.safeParse({ title: '' }).success).toBe(false);
  });
});
