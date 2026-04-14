// workflow_weekly_digest — wraps `gws workflow +weekly-digest`. Read-only.

import { z } from 'zod/v3';

import type { ToolDef, ToolResult } from '../types.js';
import { buildArgv, invokeVendorHelper } from './helpers.js';

const InputSchema = z.object({
  dry_run: z.boolean().optional(),
  account: z.string().email().optional(),
  extra_params: z.record(z.string()).optional(),
});

const OutputSchema = z
  .object({
    meetings: z.array(z.unknown()).optional(),
    unreadCount: z.number().optional(),
    triageSummary: z.unknown().optional(),
    generatedAt: z.string().optional(),
  })
  .passthrough();

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const workflowWeeklyDigest: ToolDef<Input, Output> = {
  name: 'workflow_weekly_digest',
  description:
    "Generates a read-only weekly summary combining this week's Google Calendar agenda with a Gmail triage summary (unread count + recent subjects) for the authenticated account. Use when the user asks for a weekly recap, a Monday planning view, or 'what's coming up this week'. Never modifies data.",
  service: 'workflow',
  readonly: true,
  input: InputSchema,
  output: OutputSchema,
  async invoke(args: Input): Promise<ToolResult<Output>> {
    const argv = buildArgv({
      service: 'workflow',
      helper: 'weekly-digest',
      flags: [
        { name: 'dry-run', boolean: args.dry_run === true, skip: args.dry_run !== true },
        { name: 'format', value: 'json' },
      ],
      ...(args.account !== undefined ? { account: args.account } : {}),
      ...(args.extra_params !== undefined ? { extraParams: args.extra_params } : {}),
    });

    return invokeVendorHelper({ argv, outputSchema: OutputSchema });
  },
};
