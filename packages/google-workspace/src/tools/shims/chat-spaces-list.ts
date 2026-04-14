// chat_spaces_list — wraps `gws chat spaces list`.

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

export const ChatSpacesListInputSchema = z
  .object({
    ...PaginationInputFragment,
    filter: z.string().optional(),
    account: z.string().email().optional(),
    extra_params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type ChatSpacesListInput = z.infer<typeof ChatSpacesListInputSchema>;

const ChatSpaceSchema = z
  .object({
    name: z.string().optional(),
    type: z.string().optional(),
    spaceType: z.string().optional(),
    displayName: z.string().optional(),
  })
  .passthrough();

const ChatSpacesListRawSchema = z
  .object({
    spaces: z.array(ChatSpaceSchema).optional(),
    nextPageToken: z.string().optional(),
  })
  .passthrough();

export const ChatSpacesListOutputSchema = z
  .object({
    ...PaginationOutputFragment,
    spaces: z.array(ChatSpaceSchema),
  })
  .passthrough();

export type ChatSpacesListOutput = z.infer<typeof ChatSpacesListOutputSchema>;

export const CHAT_SPACES_LIST_DESCRIPTION =
  'Lists Google Chat spaces the authenticated account is a member of (rooms and direct messages). ' +
  'Use when you need space IDs or membership metadata, e.g. to post a message with `gws chat +send`. ' +
  'Group chats and DMs don\'t appear until the first message is sent (Chat API quirk).';

async function invoke(
  args: ChatSpacesListInput,
  _ctx: ToolContext,
): Promise<ToolResult<ChatSpacesListOutput>> {
  void _ctx;
  const surfaced: Record<string, unknown> = {
    ...toGwsPaginationParams(args, { pageSizeKey: 'pageSize' }),
  };
  if (args.filter !== undefined) surfaced['filter'] = args.filter;
  const apiParams = mergeParams(surfaced, args.extra_params);

  const raw = await runGwsJson(
    {
      subcommand: ['chat', 'spaces', 'list'],
      apiParams,
      ...(args.account !== undefined ? { account: args.account } : {}),
    },
    ChatSpacesListRawSchema,
  );
  if (!raw.ok) return raw;

  const spaces = raw.data.spaces ?? [];
  const pagination = normalizePaginationResponse(raw.data);
  return {
    ok: true,
    data: {
      spaces,
      ...pagination,
    },
  };
}

export const chatSpacesList: ToolDef<ChatSpacesListInput, ChatSpacesListOutput> = {
  name: 'chat_spaces_list',
  description: CHAT_SPACES_LIST_DESCRIPTION,
  service: 'chat',
  readonly: true,
  input: ChatSpacesListInputSchema,
  output: ChatSpacesListOutputSchema,
  invoke,
};
