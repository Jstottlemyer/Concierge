// drive_files_list — Concierge shim over `gws drive files list`.
//
// Decision #13.5 description: what it does, when to use, routing hint to
// claude.ai's hosted Drive connector for semantic search. Claude should pick
// this tool when it needs a metadata-only listing or targeted q-parameter
// query, not for free-form "find the doc that says X" searches.

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

/** Surface only the most common list params; advanced users reach via extra_params. */
export const DriveFilesListInputSchema = z
  .object({
    ...PaginationInputFragment,
    query: z.string().optional(),
    include_shared_drives: z.boolean().optional(),
    order_by: z.string().optional(),
    fields: z.string().optional(),
    account: z.string().email().optional(),
    extra_params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type DriveFilesListInput = z.infer<typeof DriveFilesListInputSchema>;

/** Drive API file resource — permissive; unknown fields allowed. */
const DriveFileSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    mimeType: z.string().optional(),
    kind: z.string().optional(),
  })
  .passthrough();

/** Raw gws/Drive response shape (what stdout emits). */
const DriveFilesListRawSchema = z
  .object({
    files: z.array(DriveFileSchema).optional(),
    nextPageToken: z.string().optional(),
    incompleteSearch: z.boolean().optional(),
    kind: z.string().optional(),
  })
  .passthrough();

/** Shim output — normalized pagination flags. */
export const DriveFilesListOutputSchema = z
  .object({
    ...PaginationOutputFragment,
    files: z.array(DriveFileSchema),
    incomplete_search: z.boolean().optional(),
  })
  .passthrough();

export type DriveFilesListOutput = z.infer<typeof DriveFilesListOutputSchema>;

export const DRIVE_FILES_LIST_DESCRIPTION =
  'Lists Google Drive files with Drive API metadata (id, name, mimeType, parents, owners). ' +
  'Use when you need file metadata, targeted q-string searches, or pagination over a large ' +
  'corpus. For semantic content search, prefer claude.ai\'s hosted Drive connector.';

async function invoke(
  args: DriveFilesListInput,
  _ctx: ToolContext,
): Promise<ToolResult<DriveFilesListOutput>> {
  void _ctx;
  const surfaced: Record<string, unknown> = {
    ...toGwsPaginationParams(args, { pageSizeKey: 'pageSize' }),
  };
  if (args.query !== undefined) surfaced['q'] = args.query;
  if (args.order_by !== undefined) surfaced['orderBy'] = args.order_by;
  if (args.fields !== undefined) surfaced['fields'] = args.fields;
  if (args.include_shared_drives !== undefined) {
    surfaced['includeItemsFromAllDrives'] = args.include_shared_drives;
    surfaced['supportsAllDrives'] = args.include_shared_drives;
  }
  const apiParams = mergeParams(surfaced, args.extra_params);

  const raw = await runGwsJson(
    {
      subcommand: ['drive', 'files', 'list'],
      apiParams,
      ...(args.account !== undefined ? { account: args.account } : {}),
    },
    DriveFilesListRawSchema,
  );
  if (!raw.ok) return raw;

  const files = raw.data.files ?? [];
  const pagination = normalizePaginationResponse(raw.data);
  const output: DriveFilesListOutput = {
    files,
    ...pagination,
    ...(raw.data.incompleteSearch !== undefined
      ? { incomplete_search: raw.data.incompleteSearch }
      : {}),
  };
  return { ok: true, data: output };
}

export const driveFilesList: ToolDef<DriveFilesListInput, DriveFilesListOutput> = {
  name: 'drive_files_list',
  description: DRIVE_FILES_LIST_DESCRIPTION,
  service: 'drive',
  readonly: true,
  input: DriveFilesListInputSchema,
  output: DriveFilesListOutputSchema,
  invoke,
};
