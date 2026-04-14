// docs_documents_get — wraps `gws docs documents get`.

import { z } from 'zod/v3';

import type { ToolDef } from '../types.js';
import {
  mergeParams,
  runGwsJson,
  type ToolContext,
  type ToolResult,
} from './common.js';

export const DocsDocumentsGetInputSchema = z
  .object({
    document_id: z.string().min(1),
    account: z.string().email().optional(),
    extra_params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type DocsDocumentsGetInput = z.infer<typeof DocsDocumentsGetInputSchema>;

export const DocsDocumentsGetOutputSchema = z
  .object({
    documentId: z.string().optional(),
    title: z.string().optional(),
    revisionId: z.string().optional(),
  })
  .passthrough();

export type DocsDocumentsGetOutput = z.infer<typeof DocsDocumentsGetOutputSchema>;

export const DOCS_DOCUMENTS_GET_DESCRIPTION =
  'Retrieves a Google Doc in full structured form (document body, styles, revisions) via the Docs API. ' +
  'Use when you need the document\'s tree-structured content — paragraph elements, named ranges, or revision metadata. ' +
  'For simple text extraction, prefer reading the Doc through claude.ai\'s hosted Drive connector.';

async function invoke(
  args: DocsDocumentsGetInput,
  _ctx: ToolContext,
): Promise<ToolResult<DocsDocumentsGetOutput>> {
  void _ctx;
  const apiParams = mergeParams({ documentId: args.document_id }, args.extra_params);
  return runGwsJson(
    {
      subcommand: ['docs', 'documents', 'get'],
      apiParams,
      ...(args.account !== undefined ? { account: args.account } : {}),
    },
    DocsDocumentsGetOutputSchema,
  );
}

export const docsDocumentsGet: ToolDef<DocsDocumentsGetInput, DocsDocumentsGetOutput> = {
  name: 'docs_documents_get',
  description: DOCS_DOCUMENTS_GET_DESCRIPTION,
  service: 'docs',
  readonly: true,
  input: DocsDocumentsGetInputSchema,
  output: DocsDocumentsGetOutputSchema,
  invoke,
};
