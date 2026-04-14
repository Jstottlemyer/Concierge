// forms_responses_list — wraps `gws forms forms responses list`.
//
// The full CLI path is `forms forms responses list` — the outer `forms` is
// the gws service, the inner `forms` is the resource, `responses` is the
// sub-resource, `list` is the verb (per T7.5 findings).

import { z } from 'zod/v3';

import type { ToolDef } from '../types.js';
import {
  mergeParams,
  runGwsJson,
  type ToolContext,
  type ToolResult,
} from './common.js';
import {
  PaginationInputFragment,
  PaginationOutputFragment,
  normalizePaginationResponse,
  toGwsPaginationParams,
} from './pagination.js';

export const FormsResponsesListInputSchema = z
  .object({
    ...PaginationInputFragment,
    form_id: z.string().min(1),
    filter: z.string().optional(),
    account: z.string().email().optional(),
    extra_params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type FormsResponsesListInput = z.infer<typeof FormsResponsesListInputSchema>;

const FormResponseSchema = z
  .object({
    formId: z.string().optional(),
    responseId: z.string().optional(),
    createTime: z.string().optional(),
    respondentEmail: z.string().optional(),
  })
  .passthrough();

const FormsResponsesListRawSchema = z
  .object({
    responses: z.array(FormResponseSchema).optional(),
    nextPageToken: z.string().optional(),
  })
  .passthrough();

export const FormsResponsesListOutputSchema = z
  .object({
    ...PaginationOutputFragment,
    responses: z.array(FormResponseSchema),
  })
  .passthrough();

export type FormsResponsesListOutput = z.infer<typeof FormsResponsesListOutputSchema>;

export const FORMS_RESPONSES_LIST_DESCRIPTION =
  'Lists submissions to a Google Form via the Forms API (answers, respondent email, timestamps). ' +
  'Use when you need to ingest or analyze form responses programmatically. ' +
  'Supply `filter` as a Google Forms API filter string to narrow results by createTime / lastSubmittedTime.';

async function invoke(
  args: FormsResponsesListInput,
  _ctx: ToolContext,
): Promise<ToolResult<FormsResponsesListOutput>> {
  void _ctx;
  const surfaced: Record<string, unknown> = {
    formId: args.form_id,
    ...toGwsPaginationParams(args, { pageSizeKey: 'pageSize' }),
  };
  if (args.filter !== undefined) surfaced['filter'] = args.filter;
  const apiParams = mergeParams(surfaced, args.extra_params);

  const raw = await runGwsJson(
    {
      subcommand: ['forms', 'forms', 'responses', 'list'],
      apiParams,
      ...(args.account !== undefined ? { account: args.account } : {}),
    },
    FormsResponsesListRawSchema,
  );
  if (!raw.ok) return raw;

  const responses = raw.data.responses ?? [];
  const pagination = normalizePaginationResponse(raw.data);
  return {
    ok: true,
    data: {
      responses,
      ...pagination,
    },
  };
}

export const formsResponsesList: ToolDef<FormsResponsesListInput, FormsResponsesListOutput> = {
  name: 'forms_responses_list',
  description: FORMS_RESPONSES_LIST_DESCRIPTION,
  service: 'forms',
  readonly: true,
  input: FormsResponsesListInputSchema,
  output: FormsResponsesListOutputSchema,
  invoke,
};
