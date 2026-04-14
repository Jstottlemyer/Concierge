// admin_reports_activities_list — wraps `gws admin-reports activities list`.
//
// Note the Admin Reports API uses `maxResults` (not `pageSize`) for page
// size — the list shim still surfaces `max_results` for consistency and
// translates to the vendor field via the shared pagination façade.

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

export const AdminReportsActivitiesListInputSchema = z
  .object({
    ...PaginationInputFragment,
    application_name: z.string().min(1),
    user_key: z.string().optional(),
    start_time: z.string().optional(),
    end_time: z.string().optional(),
    event_name: z.string().optional(),
    account: z.string().email().optional(),
    extra_params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type AdminReportsActivitiesListInput = z.infer<typeof AdminReportsActivitiesListInputSchema>;

const AdminActivitySchema = z
  .object({
    kind: z.string().optional(),
    id: z.record(z.string(), z.unknown()).optional(),
    actor: z.record(z.string(), z.unknown()).optional(),
    events: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough();

const AdminReportsActivitiesListRawSchema = z
  .object({
    items: z.array(AdminActivitySchema).optional(),
    nextPageToken: z.string().optional(),
    kind: z.string().optional(),
  })
  .passthrough();

export const AdminReportsActivitiesListOutputSchema = z
  .object({
    ...PaginationOutputFragment,
    items: z.array(AdminActivitySchema),
  })
  .passthrough();

export type AdminReportsActivitiesListOutput = z.infer<
  typeof AdminReportsActivitiesListOutputSchema
>;

export const ADMIN_REPORTS_ACTIVITIES_LIST_DESCRIPTION =
  'Lists Google Workspace audit-log activities for a customer (login events, drive access, etc.) via the Admin Reports API. ' +
  'Use when you need audit entries — who did what, when — scoped by application_name (e.g. "login", "drive", "admin"). ' +
  'Requires admin scopes. Default user_key is "all" (every user); pass a specific email to narrow.';

async function invoke(
  args: AdminReportsActivitiesListInput,
  _ctx: ToolContext,
): Promise<ToolResult<AdminReportsActivitiesListOutput>> {
  void _ctx;
  const surfaced: Record<string, unknown> = {
    userKey: args.user_key ?? 'all',
    applicationName: args.application_name,
    ...toGwsPaginationParams(args, { pageSizeKey: 'maxResults' }),
  };
  if (args.start_time !== undefined) surfaced['startTime'] = args.start_time;
  if (args.end_time !== undefined) surfaced['endTime'] = args.end_time;
  if (args.event_name !== undefined) surfaced['eventName'] = args.event_name;
  const apiParams = mergeParams(surfaced, args.extra_params);

  const raw = await runGwsJson(
    {
      subcommand: ['admin-reports', 'activities', 'list'],
      apiParams,
      ...(args.account !== undefined ? { account: args.account } : {}),
    },
    AdminReportsActivitiesListRawSchema,
  );
  if (!raw.ok) return raw;

  const items = raw.data.items ?? [];
  const pagination = normalizePaginationResponse(raw.data);
  return {
    ok: true,
    data: {
      items,
      ...pagination,
    },
  };
}

export const adminReportsActivitiesList: ToolDef<
  AdminReportsActivitiesListInput,
  AdminReportsActivitiesListOutput
> = {
  name: 'admin_reports_activities_list',
  description: ADMIN_REPORTS_ACTIVITIES_LIST_DESCRIPTION,
  service: 'admin-reports',
  readonly: true,
  input: AdminReportsActivitiesListInputSchema,
  output: AdminReportsActivitiesListOutputSchema,
  invoke,
};
