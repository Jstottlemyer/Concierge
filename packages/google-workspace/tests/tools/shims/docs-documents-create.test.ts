// TDD — T12 shim: docs_documents_create.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { __resetVersionCacheForTests } from '../../../src/gws/runner.js';
import { GWS_BIN_ENV } from '../../../src/gws/paths.js';
import { installGwsMock, type InstalledGwsMock } from '../../helpers/gws-mock.js';
import {
  makeVersionScenario,
  loadGwsResponseFixture,
} from '../../helpers/gws-mock-scenarios.js';
import { docsDocumentsCreate } from '../../../src/tools/shims/docs-documents-create.js';
import type { ToolContext } from '../../../src/tools/types.js';

const ctx: ToolContext = { now: '2026-04-13T00:00:00.000Z' };

describe('docs_documents_create shim', () => {
  const priorBin = process.env[GWS_BIN_ENV];
  let mock: InstalledGwsMock | null = null;
  beforeEach(() => { __resetVersionCacheForTests(); });
  afterEach(async () => {
    if (mock !== null) { await mock.uninstall(); mock = null; }
    __resetVersionCacheForTests();
    if (priorBin === undefined) delete process.env[GWS_BIN_ENV];
    else process.env[GWS_BIN_ENV] = priorBin;
  });

  it('is a write tool tagged docs', () => {
    expect(docsDocumentsCreate.readonly).toBe(false);
    expect(docsDocumentsCreate.service).toBe('docs');
  });

  it('creates a new doc with the supplied title', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'docs', 'documents', 'create',
            '--format', 'json',
            '--params', JSON.stringify({}),
            '--json', JSON.stringify({ title: 'New Concierge Doc' }),
          ],
          stdout: loadGwsResponseFixture('docs.documents.create'),
          exitCode: 0,
        },
      ],
    });
    const result = await docsDocumentsCreate.invoke({ title: 'New Concierge Doc' }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('x');
    expect(result.data.documentId).toBe('1FAKE_NEW_DOC_ID_ABCDEFGHIJKLMNOPQRST');
  });

  it('rejects empty title', () => {
    expect(docsDocumentsCreate.input.safeParse({ title: '' }).success).toBe(false);
  });

  it('surfaces gws validation failures', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'docs', 'documents', 'create',
            '--format', 'json',
            '--params', JSON.stringify({}),
            '--json', JSON.stringify({ title: 'Bad' }),
          ],
          stderr: 'bad title\n',
          exitCode: 3,
        },
      ],
    });
    const result = await docsDocumentsCreate.invoke({ title: 'Bad' }, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('x');
    expect(result.error.error_code).toBe('validation_error');
  });
});
