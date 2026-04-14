// admin_reports_usage_get — wraps `gws admin-reports userUsageReport get`.
//
// CLI quirk: the method path is `userUsageReport` (singular, camelCase) per
// the actual gws Discovery-doc binding. This shim normalizes both that
// quirk and the Google-style parameter names to snake_case inputs.

import { z } from 'zod/v3';

import type { ToolDef } from '../types.js';
import {
  mergeParams,
  runGwsJson,
  type ToolContext,
  type ToolResult,
} from './common.js';

export const AdminReportsUsageGetInputSchema = z
  .object({
    user_key: z.string().min(1),
    date: z.string().min(1),
    parameters: z.string().optional(),
    customer_id: z.string().optional(),
    account: z.string().email().optional(),
    extra_params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type AdminReportsUsageGetInput = z.infer<typeof AdminReportsUsageGetInputSchema>;

export const AdminReportsUsageGetOutputSchema = z
  .object({
    kind: z.string().optional(),
    usageReports: z.array(z.record(z.string(), z.unknown())).optional(),
    warnings: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough();

export type AdminReportsUsageGetOutput = z.infer<typeof AdminReportsUsageGetOutputSchema>;

export const ADMIN_REPORTS_USAGE_GET_DESCRIPTION =
  'Retrieves per-user usage statistics for a specific date via the Admin Reports API (userUsageReport get). ' +
  'Use when you need per-user daily activity metrics — last login time, email volume, Drive edits, etc. ' +
  'Requires admin scopes. Pass a comma-separated `parameters` filter to restrict which metrics the API returns.';

async function invoke(
  args: AdminReportsUsageGetInput,
  _ctx: ToolContext,
): Promise<ToolResult<AdminReportsUsageGetOutput>> {
  void _ctx;
  const surfaced: Record<string, unknown> = {
    userKey: args.user_key,
    date: args.date,
  };
  if (args.parameters !== undefined) surfaced['parameters'] = args.parameters;
  if (args.customer_id !== undefined) surfaced['customerId'] = args.customer_id;
  const apiParams = mergeParams(surfaced, args.extra_params);

  return runGwsJson(
    {
      subcommand: ['admin-reports', 'userUsageReport', 'get'],
      apiParams,
      ...(args.account !== undefined ? { account: args.account } : {}),
    },
    AdminReportsUsageGetOutputSchema,
  );
}

export const adminReportsUsageGet: ToolDef<
  AdminReportsUsageGetInput,
  AdminReportsUsageGetOutput
> = {
  name: 'admin_reports_usage_get',
  description: ADMIN_REPORTS_USAGE_GET_DESCRIPTION,
  service: 'admin-reports',
  readonly: true,
  input: AdminReportsUsageGetInputSchema,
  output: AdminReportsUsageGetOutputSchema,
  invoke,
};
