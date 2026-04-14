// gmail_forward — wraps `gws gmail +forward`. Vendor helper (T11).

import { z } from 'zod/v3';

import type { ToolDef, ToolResult } from '../types.js';
import { buildArgv, invokeVendorHelper } from './helpers.js';

const InputSchema = z.object({
  message_id: z.string().min(1).describe('Gmail message ID to forward.'),
  to: z.array(z.string().email()).min(1).describe('Recipient email addresses.'),
  body: z.string().optional().describe('Optional note to include above the forwarded message.'),
  html: z.boolean().optional(),
  from: z.string().email().optional(),
  cc: z.array(z.string().email()).optional(),
  bcc: z.array(z.string().email()).optional(),
  attach: z.array(z.string()).optional(),
  no_original_attachments: z
    .boolean()
    .optional()
    .describe('Exclude attachments from the original message.'),
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

export const gmailForward: ToolDef<Input, Output> = {
  name: 'gmail_forward',
  description:
    "Forwards an existing Gmail message to new recipients, optionally with a leading note and with original attachments preserved by default. Use when the user asks to forward an email they have identified by message ID. For reading or searching Gmail, prefer claude.ai's hosted Gmail connector; for composing new messages, use gmail_send.",
  service: 'gmail',
  readonly: false,
  input: InputSchema,
  output: OutputSchema,
  async invoke(args: Input): Promise<ToolResult<Output>> {
    const argv = buildArgv({
      service: 'gmail',
      helper: 'forward',
      flags: [
        { name: 'message-id', value: args.message_id },
        { name: 'to', value: args.to.join(',') },
        { name: 'body', value: args.body, skip: args.body === undefined },
        { name: 'html', boolean: args.html === true, skip: args.html !== true },
        { name: 'from', value: args.from, skip: args.from === undefined },
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
          name: 'no-original-attachments',
          boolean: args.no_original_attachments === true,
          skip: args.no_original_attachments !== true,
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
