// workflow_file_announce — wraps `gws workflow +file-announce`. Write.

import { z } from 'zod/v3';

import type { ToolDef, ToolResult } from '../types.js';
import { buildArgv, invokeVendorHelper } from './helpers.js';

const InputSchema = z.object({
  file_id: z.string().min(1).describe('Drive file ID to announce.'),
  space: z.string().min(1).describe('Chat space name (e.g. spaces/SPACE_ID).'),
  message: z.string().optional().describe('Custom announcement text; otherwise a default is generated.'),
  dry_run: z.boolean().optional(),
  account: z.string().email().optional(),
  extra_params: z.record(z.string()).optional(),
});

const OutputSchema = z
  .object({
    name: z.string().optional(),
    text: z.string().optional(),
    createTime: z.string().optional(),
    space: z.unknown().optional(),
  })
  .passthrough();

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const workflowFileAnnounce: ToolDef<Input, Output> = {
  name: 'workflow_file_announce',
  description:
    'Announces a Google Drive file in a Google Chat space by fetching the filename and posting a Chat message that references it. Use when the user asks to share a Drive file with a team, post a link in a room, or announce a newly uploaded file. This is a write operation — a message is sent to the space.',
  service: 'workflow',
  readonly: false,
  input: InputSchema,
  output: OutputSchema,
  async invoke(args: Input): Promise<ToolResult<Output>> {
    const argv = buildArgv({
      service: 'workflow',
      helper: 'file-announce',
      flags: [
        { name: 'file-id', value: args.file_id },
        { name: 'space', value: args.space },
        { name: 'message', value: args.message, skip: args.message === undefined },
        { name: 'dry-run', boolean: args.dry_run === true, skip: args.dry_run !== true },
        { name: 'format', value: 'json' },
      ],
      ...(args.account !== undefined ? { account: args.account } : {}),
      ...(args.extra_params !== undefined ? { extraParams: args.extra_params } : {}),
    });

    return invokeVendorHelper({ argv, outputSchema: OutputSchema });
  },
};
