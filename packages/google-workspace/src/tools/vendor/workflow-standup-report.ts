// workflow_standup_report — wraps `gws workflow +standup-report`. Read-only.

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
    tasks: z.array(z.unknown()).optional(),
    generatedAt: z.string().optional(),
  })
  .passthrough();

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const workflowStandupReport: ToolDef<Input, Output> = {
  name: 'workflow_standup_report',
  description:
    "Generates a read-only daily standup summary combining today's Google Calendar agenda with open Google Tasks for the authenticated account. Use when the user asks for a morning recap, a 'what's on today' summary, or standup talking points. Never modifies data.",
  service: 'workflow',
  readonly: true,
  input: InputSchema,
  output: OutputSchema,
  async invoke(args: Input): Promise<ToolResult<Output>> {
    const argv = buildArgv({
      service: 'workflow',
      helper: 'standup-report',
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
