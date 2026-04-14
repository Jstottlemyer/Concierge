// workflow_email_to_task — wraps `gws workflow +email-to-task`. Write.

import { z } from 'zod/v3';

import type { ToolDef, ToolResult } from '../types.js';
import { buildArgv, invokeVendorHelper } from './helpers.js';

const InputSchema = z.object({
  message_id: z.string().min(1).describe('Gmail message ID to convert.'),
  tasklist: z
    .string()
    .optional()
    .describe('Task list ID (default: @default).'),
  dry_run: z.boolean().optional(),
  account: z.string().email().optional(),
  extra_params: z.record(z.string()).optional(),
});

const OutputSchema = z
  .object({
    id: z.string().optional(),
    title: z.string().optional(),
    notes: z.string().optional(),
    status: z.string().optional(),
    selfLink: z.string().optional(),
  })
  .passthrough();

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const workflowEmailToTask: ToolDef<Input, Output> = {
  name: 'workflow_email_to_task',
  description:
    'Converts a Gmail message into a new Google Tasks entry, using the email subject as task title and the snippet as notes. Use when the user asks to turn an email into a todo, save a message as a task, or capture an email as followup. Creates a new task — this is a write operation.',
  service: 'workflow',
  readonly: false,
  input: InputSchema,
  output: OutputSchema,
  async invoke(args: Input): Promise<ToolResult<Output>> {
    const argv = buildArgv({
      service: 'workflow',
      helper: 'email-to-task',
      flags: [
        { name: 'message-id', value: args.message_id },
        { name: 'tasklist', value: args.tasklist, skip: args.tasklist === undefined },
        { name: 'dry-run', boolean: args.dry_run === true, skip: args.dry_run !== true },
        { name: 'format', value: 'json' },
      ],
      ...(args.account !== undefined ? { account: args.account } : {}),
      ...(args.extra_params !== undefined ? { extraParams: args.extra_params } : {}),
    });

    return invokeVendorHelper({ argv, outputSchema: OutputSchema });
  },
};
