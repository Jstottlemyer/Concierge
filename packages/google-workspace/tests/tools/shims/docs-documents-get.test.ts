// TDD — T12 shim: docs_documents_get.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { __resetVersionCacheForTests } from '../../../src/gws/runner.js';
import { GWS_BIN_ENV } from '../../../src/gws/paths.js';
import { installGwsMock, type InstalledGwsMock } from '../../helpers/gws-mock.js';
import {
  makeVersionScenario,
  loadGwsResponseFixture,
} from '../../helpers/gws-mock-scenarios.js';
import { docsDocumentsGet } from '../../../src/tools/shims/docs-documents-get.js';
import type { ToolContext } from '../../../src/tools/types.js';

const ctx: ToolContext = { now: '2026-04-13T00:00:00.000Z' };

describe('docs_documents_get shim', () => {
  const priorBin = process.env[GWS_BIN_ENV];
  let mock: InstalledGwsMock | null = null;
  beforeEach(() => { __resetVersionCacheForTests(); });
  afterEach(async () => {
    if (mock !== null) { await mock.uninstall(); mock = null; }
    __resetVersionCacheForTests();
    if (priorBin === undefined) delete process.env[GWS_BIN_ENV];
    else process.env[GWS_BIN_ENV] = priorBin;
  });

  it('is readonly + tagged docs', () => {
    expect(docsDocumentsGet.name).toBe('docs_documents_get');
    expect(docsDocumentsGet.readonly).toBe(true);
    expect(docsDocumentsGet.service).toBe('docs');
  });

  it('fetches a document by id', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'docs', 'documents', 'get',
            '--format', 'json',
            '--params', JSON.stringify({ documentId: 'DOC1' }),
          ],
          stdout: loadGwsResponseFixture('docs.documents.get'),
          exitCode: 0,
        },
      ],
    });
    const result = await docsDocumentsGet.invoke({ document_id: 'DOC1' }, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('x');
    expect(result.data.documentId).toBe('1FAKE_DOC_ID_ABCDEFGHIJKLMNOPQRSTUV');
    expect(result.data.title).toBe('Sample Doc');
  });

  it('rejects empty document_id', () => {
    expect(docsDocumentsGet.input.safeParse({ document_id: '' }).success).toBe(false);
  });

  it('propagates gws errors', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'docs', 'documents', 'get',
            '--format', 'json',
            '--params', JSON.stringify({ documentId: 'DOC1' }),
          ],
          stderr: 'nope\n',
          exitCode: 2,
        },
      ],
    });
    const result = await docsDocumentsGet.invoke({ document_id: 'DOC1' }, ctx);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('x');
    expect(result.error.error_code).toBe('account_revoked');
  });
});
