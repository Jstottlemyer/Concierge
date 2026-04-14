// docs_documents_create — wraps `gws docs documents create`.

import { z } from 'zod/v3';

import type { ToolDef } from '../types.js';
import {
  mergeParams,
  runGwsJson,
  type ToolContext,
  type ToolResult,
} from './common.js';

export const DocsDocumentsCreateInputSchema = z
  .object({
    title: z.string().min(1),
    account: z.string().email().optional(),
    extra_params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type DocsDocumentsCreateInput = z.infer<typeof DocsDocumentsCreateInputSchema>;

export const DocsDocumentsCreateOutputSchema = z
  .object({
    documentId: z.string().optional(),
    title: z.string().optional(),
    revisionId: z.string().optional(),
  })
  .passthrough();

export type DocsDocumentsCreateOutput = z.infer<typeof DocsDocumentsCreateOutputSchema>;

export const DOCS_DOCUMENTS_CREATE_DESCRIPTION =
  'Creates a blank Google Doc with the given title via the Docs API. ' +
  'Use when you need a new document to then populate via Docs batch-update or the ' +
  '`gws docs +write` helper. Only `title` is persisted server-side; body content must be added separately.';

async function invoke(
  args: DocsDocumentsCreateInput,
  _ctx: ToolContext,
): Promise<ToolResult<DocsDocumentsCreateOutput>> {
  void _ctx;
  const apiParams = mergeParams({}, args.extra_params);
  const body = { title: args.title };
  return runGwsJson(
    {
      subcommand: ['docs', 'documents', 'create'],
      apiParams,
      ...(args.account !== undefined ? { account: args.account } : {}),
      extraArgs: ['--json', JSON.stringify(body)],
    },
    DocsDocumentsCreateOutputSchema,
  );
}

export const docsDocumentsCreate: ToolDef<DocsDocumentsCreateInput, DocsDocumentsCreateOutput> = {
  name: 'docs_documents_create',
  description: DOCS_DOCUMENTS_CREATE_DESCRIPTION,
  service: 'docs',
  readonly: false,
  input: DocsDocumentsCreateInputSchema,
  output: DocsDocumentsCreateOutputSchema,
  invoke,
};
