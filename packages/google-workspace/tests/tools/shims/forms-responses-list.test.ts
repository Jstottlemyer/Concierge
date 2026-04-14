// TDD — T12 shim: forms_responses_list (pagination).
//
// Note CLI path: `gws forms forms responses list` — outer `forms` = service,
// inner `forms` = resource, `responses` = sub-resource. Per T7.5 findings.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { __resetVersionCacheForTests } from '../../../src/gws/runner.js';
import { GWS_BIN_ENV } from '../../../src/gws/paths.js';
import { installGwsMock, type InstalledGwsMock } from '../../helpers/gws-mock.js';
import {
  makeVersionScenario,
  loadGwsResponseFixture,
} from '../../helpers/gws-mock-scenarios.js';
import { formsResponsesList } from '../../../src/tools/shims/forms-responses-list.js';
import type { ToolContext } from '../../../src/tools/types.js';

const ctx: ToolContext = { now: '2026-04-13T00:00:00.000Z' };

describe('forms_responses_list shim', () => {
  const priorBin = process.env[GWS_BIN_ENV];
  let mock: InstalledGwsMock | null = null;
  beforeEach(() => { __resetVersionCacheForTests(); });
  afterEach(async () => {
    if (mock !== null) { await mock.uninstall(); mock = null; }
    __resetVersionCacheForTests();
    if (priorBin === undefined) delete process.env[GWS_BIN_ENV];
    else process.env[GWS_BIN_ENV] = priorBin;
  });

  it('is readonly + forms service', () => {
    expect(formsResponsesList.readonly).toBe(true);
    expect(formsResponsesList.service).toBe('forms');
  });

  it('invokes `forms forms responses list` (full path)', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'forms', 'forms', 'responses', 'list',
            '--format', 'json',
            '--params', JSON.stringify({
              formId: 'FORM1',
              pageSize: 50,
            }),
          ],
          stdout: loadGwsResponseFixture('forms.responses.list'),
          exitCode: 0,
        },
      ],
    });
    const result = await formsResponsesList.invoke({ form_id: 'FORM1' }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('x');
    expect(result.data.responses).toHaveLength(2);
    expect(result.data.has_more).toBe(false);
  });

  it('translates max_results + page_token', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'forms', 'forms', 'responses', 'list',
            '--format', 'json',
            '--params', JSON.stringify({
              formId: 'FORM1',
              pageSize: 5,
              pageToken: 'abc',
            }),
          ],
          stdout: loadGwsResponseFixture('forms.responses.list'),
          exitCode: 0,
        },
      ],
    });
    const result = await formsResponsesList.invoke(
      { form_id: 'FORM1', max_results: 5, page_token: 'abc' },
      ctx,
    );
    expect(result.ok).toBe(true);
  });

  it('rejects missing form_id', () => {
    expect(formsResponsesList.input.safeParse({}).success).toBe(false);
  });
});
