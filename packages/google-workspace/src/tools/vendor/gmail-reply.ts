// gmail_reply — wraps `gws gmail +reply`. Vendor helper (T11).

import { z } from 'zod/v3';

import type { ToolDef, ToolResult } from '../types.js';
import { buildArgv, invokeVendorHelper } from './helpers.js';

const InputSchema = z.object({
  message_id: z.string().min(1).describe('Gmail message ID to reply to.'),
  body: z.string().describe('Reply body (plain text by default; pass html=true for HTML).'),
  html: z.boolean().optional().describe('Treat body as HTML fragment content.'),
  from: z.string().email().optional().describe('Send-as alias address.'),
  to: z.array(z.string().email()).optional().describe('Additional To recipients.'),
  cc: z.array(z.string().email()).optional().describe('CC recipients.'),
  bcc: z.array(z.string().email()).optional().describe('BCC recipients.'),
  attach: z.array(z.string()).optional().describe('Local file paths to attach (repeatable).'),
  draft: z.boolean().optional().describe('Save as draft instead of sending.'),
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

export const gmailReply: ToolDef<Input, Output> = {
  name: 'gmail_reply',
  description:
    "Replies to an existing Gmail message, preserving threading headers (In-Reply-To, References, threadId) and quoting the original. Use when the user asks to reply to a specific email they have identified by message ID. For reply-all, use gmail_reply_all instead; for composing a brand-new email, use gmail_send. For reading or searching email, prefer claude.ai's hosted Gmail connector.",
  service: 'gmail',
  readonly: false,
  input: InputSchema,
  output: OutputSchema,
  async invoke(args: Input): Promise<ToolResult<Output>> {
    const argv = buildArgv({
      service: 'gmail',
      helper: 'reply',
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
