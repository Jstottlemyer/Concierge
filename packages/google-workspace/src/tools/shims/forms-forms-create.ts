// forms_forms_create — wraps `gws forms forms create`.

import { z } from 'zod/v3';

import type { ToolDef } from '../types.js';
import {
  mergeParams,
  runGwsJson,
  type ToolContext,
  type ToolResult,
} from './common.js';

export const FormsFormsCreateInputSchema = z
  .object({
    title: z.string().min(1),
    document_title: z.string().optional(),
    account: z.string().email().optional(),
    extra_params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type FormsFormsCreateInput = z.infer<typeof FormsFormsCreateInputSchema>;

export const FormsFormsCreateOutputSchema = z
  .object({
    formId: z.string().optional(),
    info: z.record(z.string(), z.unknown()).optional(),
    revisionId: z.string().optional(),
    responderUri: z.string().optional(),
  })
  .passthrough();

export type FormsFormsCreateOutput = z.infer<typeof FormsFormsCreateOutputSchema>;

export const FORMS_FORMS_CREATE_DESCRIPTION =
  'Creates a new Google Form with the given title via the Forms API. ' +
  'Use when you need a fresh form to then populate with questions via a separate Forms batch-update. ' +
  'Note: only `info.title` and `info.documentTitle` are copied from the initial request body.';

async function invoke(
  args: FormsFormsCreateInput,
  _ctx: ToolContext,
): Promise<ToolResult<FormsFormsCreateOutput>> {
  void _ctx;
  const apiParams = mergeParams({}, args.extra_params);

  const info: Record<string, unknown> = { title: args.title };
  if (args.document_title !== undefined) info['documentTitle'] = args.document_title;
  const body = { info };

  return runGwsJson(
    {
      subcommand: ['forms', 'forms', 'create'],
      apiParams,
      ...(args.account !== undefined ? { account: args.account } : {}),
      extraArgs: ['--json', JSON.stringify(body)],
    },
    FormsFormsCreateOutputSchema,
  );
}

export const formsFormsCreate: ToolDef<FormsFormsCreateInput, FormsFormsCreateOutput> = {
  name: 'forms_forms_create',
  description: FORMS_FORMS_CREATE_DESCRIPTION,
  service: 'forms',
  readonly: false,
  input: FormsFormsCreateInputSchema,
  output: FormsFormsCreateOutputSchema,
  invoke,
};
