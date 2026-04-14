// workflow_meeting_prep — wraps `gws workflow +meeting-prep`. Read-only.

import { z } from 'zod/v3';

import type { ToolDef, ToolResult } from '../types.js';
import { buildArgv, invokeVendorHelper } from './helpers.js';

const InputSchema = z.object({
  calendar: z
    .string()
    .optional()
    .describe("Calendar ID (default: primary)."),
  dry_run: z.boolean().optional(),
  account: z.string().email().optional(),
  extra_params: z.record(z.string()).optional(),
});

const OutputSchema = z
  .object({
    event: z.unknown().optional(),
    attendees: z.array(z.unknown()).optional(),
    linkedDocs: z.array(z.unknown()).optional(),
  })
  .passthrough();

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const workflowMeetingPrep: ToolDef<Input, Output> = {
  name: 'workflow_meeting_prep',
  description:
    "Returns a read-only briefing for the next upcoming calendar event: agenda, attendees, and linked documents from the description. Use when the user asks to prep for their next meeting, see who's on the next call, or find the meeting doc they need. Never modifies data.",
  service: 'workflow',
  readonly: true,
  input: InputSchema,
  output: OutputSchema,
  async invoke(args: Input): Promise<ToolResult<Output>> {
    const argv = buildArgv({
      service: 'workflow',
      helper: 'meeting-prep',
      flags: [
        { name: 'calendar', value: args.calendar, skip: args.calendar === undefined },
        { name: 'dry-run', boolean: args.dry_run === true, skip: args.dry_run !== true },
        { name: 'format', value: 'json' },
      ],
      ...(args.account !== undefined ? { account: args.account } : {}),
      ...(args.extra_params !== undefined ? { extraParams: args.extra_params } : {}),
    });

    return invokeVendorHelper({ argv, outputSchema: OutputSchema });
  },
};
