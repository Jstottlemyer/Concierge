// gmail_send — wraps `gws gmail +send`. Vendor helper (T11).
//
// Schema derived from tests/fixtures/gws-help/gmail_send.txt. The helper is
// one of the hero use cases for Concierge: Claude Desktop users ask the
// assistant to send email and expect a single-turn result. We surface the
// full flag set except `--format` (which the tool fixes to JSON to keep
// stdout parseable) and `--sanitize` (deferred to Wave 7 policy work).

import { z } from 'zod/v3';

import type { ToolDef, ToolResult } from '../types.js';
import { buildArgv, invokeVendorHelper } from './helpers.js';

const InputSchema = z.object({
  to: z.array(z.string().email()).min(1).describe('Recipient email addresses (To).'),
  subject: z.string().min(1).describe('Email subject.'),
  body: z.string().describe('Email body (plain text by default; pass html=true for HTML).'),
  html: z.boolean().optional().describe('Treat body as HTML fragment content.'),
  from: z
    .string()
    .email()
    .optional()
    .describe('Send-as alias address. Omit to use the account default.'),
  cc: z.array(z.string().email()).optional().describe('CC recipients.'),
  bcc: z.array(z.string().email()).optional().describe('BCC recipients.'),
  attach: z.array(z.string()).optional().describe('Local file paths to attach (repeatable).'),
  draft: z.boolean().optional().describe('Save as draft instead of sending.'),
  dry_run: z.boolean().optional().describe('Show the request that would be sent without executing it.'),
  account: z.string().email().optional().describe('Authenticated account to send from.'),
  extra_params: z
    .record(z.string())
    .optional()
    .describe('Escape hatch for additional --flag value pairs not surfaced above.'),
});

// Gmail's users.messages.send response: { id, threadId, labelIds? }. We
// passthrough unknown fields because gws may include dry-run scaffolding or
// a `draft` envelope when --draft is passed.
const OutputSchema = z
  .object({
    id: z.string().optional(),
    threadId: z.string().optional(),
    labelIds: z.array(z.string()).optional(),
  })
  .passthrough();

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const gmailSend: ToolDef<Input, Output> = {
  name: 'gmail_send',
  description:
    "Sends a new Gmail message from the authenticated Google Workspace account, with optional CC/BCC, attachments, HTML body, and send-as alias. Use when the user asks to compose and send (or draft) a brand-new email. For reading, searching, or browsing existing email, prefer claude.ai's hosted Gmail connector.",
  service: 'gmail',
  readonly: false,
  input: InputSchema,
  output: OutputSchema,
  async invoke(args: Input): Promise<ToolResult<Output>> {
    const argv = buildArgv({
      service: 'gmail',
      helper: 'send',
      flags: [
        { name: 'to', value: args.to.join(',') },
        { name: 'subject', value: args.subject },
        { name: 'body', value: args.body },
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
