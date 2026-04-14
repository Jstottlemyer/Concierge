// gmail_reply_all — wraps `gws gmail +reply-all`. Vendor helper (T11).

import { z } from 'zod/v3';

import type { ToolDef, ToolResult } from '../types.js';
import { buildArgv, invokeVendorHelper } from './helpers.js';

const InputSchema = z.object({
  message_id: z.string().min(1).describe('Gmail message ID to reply to.'),
  body: z.string().describe('Reply body (plain text by default; pass html=true for HTML).'),
  html: z.boolean().optional(),
  from: z.string().email().optional(),
  to: z.array(z.string().email()).optional().describe('Additional To recipients.'),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  attach: z.array(z.string()).optional(),
  remove: z
    .array(z.string().email())
    .optional()
    .describe('Recipients to exclude from the outgoing reply.'),
  draft: z.boolean().optional(),
  dry_run: z.boolean().optional(),
  account: z.string().email().optional(),
  extra_params: z.record(z.string()).optional(),
});

const OutputSchema = z
  .object({
    id: z.string().optional(),
    threadId: z.string().optional(),
    labelIds: z.array(z.string()).optional(),
  })
  .passthrough();

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const gmailReplyAll: ToolDef<Input, Output> = {
  name: 'gmail_reply_all',
  description:
    "Replies to all original recipients (sender + To + CC) of a Gmail message, preserving threading. Supports excluding specific recipients via the remove field. Use when the user asks to reply-all to a thread. For replying to only the original sender, use gmail_reply; for reading or searching, prefer claude.ai's hosted Gmail connector.",
  service: 'gmail',
  readonly: false,
  input: InputSchema,
  output: OutputSchema,
  async invoke(args: Input): Promise<ToolResult<Output>> {
    const argv = buildArgv({
      service: 'gmail',
      helper: 'reply-all',
      flags: [
        { name: 'message-id', value: args.message_id },
        { name: 'body', value: args.body },
        { name: 'html', boolean: args.html === true, skip: args.html !== true },
        { name: 'from', value: args.from, skip: args.from === undefined },
        {
          name: 'to',
          value: args.to?.join(','),
          skip: args.to === undefined || args.to.length === 0,
        },
        {
          name: 'cc',
          value: args.cc?.join(','),
          skip: args.cc === undefined || args.cc.length === 0,
        },
        {
          name: 'bcc',
          value: args.bcc?.join(','),
          skip: args.bcc === undefined || args.bcc.length === 0,
        },
        {
          name: 'attach',
          repeat: args.attach,
          skip: args.attach === undefined || args.attach.length === 0,
        },
        {
          name: 'remove',
          value: args.remove?.join(','),
          skip: args.remove === undefined || args.remove.length === 0,
        },
        { name: 'draft', boolean: args.draft === true, skip: args.draft !== true },
        { name: 'dry-run', boolean: args.dry_run === true, skip: args.dry_run !== true },
        { name: 'format', value: 'json' },
      ],
      ...(args.account !== undefined ? { account: args.account } : {}),
      ...(args.extra_params !== undefined ? { extraParams: args.extra_params } : {}),
    });

    return invokeVendorHelper({ argv, outputSchema: OutputSchema });
  },
};
