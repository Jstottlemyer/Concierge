// TDD — T12 shim: forms_forms_create.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { __resetVersionCacheForTests } from '../../../src/gws/runner.js';
import { GWS_BIN_ENV } from '../../../src/gws/paths.js';
import { installGwsMock, type InstalledGwsMock } from '../../helpers/gws-mock.js';
import {
  makeVersionScenario,
  loadGwsResponseFixture,
} from '../../helpers/gws-mock-scenarios.js';
import { formsFormsCreate } from '../../../src/tools/shims/forms-forms-create.js';
import type { ToolContext } from '../../../src/tools/types.js';

const ctx: ToolContext = { now: '2026-04-13T00:00:00.000Z' };

describe('forms_forms_create shim', () => {
  const priorBin = process.env[GWS_BIN_ENV];
  let mock: InstalledGwsMock | null = null;
  beforeEach(() => { __resetVersionCacheForTests(); });
  afterEach(async () => {
    if (mock !== null) { await mock.uninstall(); mock = null; }
    __resetVersionCacheForTests();
    if (priorBin === undefined) delete process.env[GWS_BIN_ENV];
    else process.env[GWS_BIN_ENV] = priorBin;
  });

  it('is write + forms service', () => {
    expect(formsFormsCreate.readonly).toBe(false);
    expect(formsFormsCreate.service).toBe('forms');
  });

  it('creates with title', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'forms', 'forms', 'create',
            '--format', 'json',
            '--params', JSON.stringify({}),
            '--json', JSON.stringify({ info: { title: 'Concierge Feedback' } }),
          ],
          stdout: loadGwsResponseFixture('forms.forms.create'),
          exitCode: 0,
        },
      ],
    });
    const result = await formsFormsCreate.invoke({ title: 'Concierge Feedback' }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('x');
    expect(result.data.formId).toBe('1FAKE_FORM_ID_ABCDEFGHIJKLMNOPQRSTUV');
  });

  it('supports document_title override', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'forms', 'forms', 'create',
            '--format', 'json',
            '--params', JSON.stringify({}),
            '--json', JSON.stringify({
              info: { title: 'Customer Survey', documentTitle: 'Q2-Customer-Survey' },
            }),
          ],
          stdout: loadGwsResponseFixture('forms.forms.create'),
          exitCode: 0,
        },
      ],
    });
    const result = await formsFormsCreate.invoke(
      { title: 'Customer Survey', document_title: 'Q2-Customer-Survey' },
      ctx,
    );
    expect(result.ok).toBe(true);
  });

  it('rejects empty title', () => {
    expect(formsFormsCreate.input.safeParse({ title: '' }).success).toBe(false);
  });
});
