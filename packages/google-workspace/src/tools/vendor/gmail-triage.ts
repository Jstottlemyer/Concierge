// gmail_triage — wraps `gws gmail +triage`. Vendor helper (T11). Read-only.

import { z } from 'zod/v3';

import type { ToolDef, ToolResult } from '../types.js';
import { buildArgv, invokeVendorHelper } from './helpers.js';

const InputSchema = z.object({
  max: z.number().int().positive().optional().describe('Maximum messages to show (default: 20).'),
  query: z
    .string()
    .optional()
    .describe('Gmail search query (default: is:unread).'),
  labels: z.boolean().optional().describe('Include label names in output.'),
  dry_run: z.boolean().optional(),
  account: z.string().email().optional(),
  extra_params: z.record(z.string()).optional(),
});

// gws triage emits an array of message summaries; we accept either an array
// directly or an object wrapper (`{ messages: [...] }`) to stay tolerant of
// vendor format shifts between minor versions.
const MessageSummary = z
  .object({
    id: z.string().optional(),
    threadId: z.string().optional(),
    subject: z.string().optional(),
    from: z.string().optional(),
    date: z.string().optional(),
    labels: z.array(z.string()).optional(),
  })
  .passthrough();

const OutputSchema = z.union([
  z.array(MessageSummary),
  z
    .object({
      messages: z.array(MessageSummary).optional(),
    })
    .passthrough(),
]);

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const gmailTriage: ToolDef<Input, Output> = {
  name: 'gmail_triage',
  description:
    "Returns a read-only summary of unread Gmail inbox messages (sender, subject, date) limited by the requested max count or a custom search query. Use when the user wants a quick overview of their inbox without modifying any messages. For full search, reading, or drafting, prefer claude.ai's hosted Gmail connector.",
  service: 'gmail',
  readonly: true,
  input: InputSchema,
  output: OutputSchema,
  async invoke(args: Input): Promise<ToolResult<Output>> {
    const argv = buildArgv({
      service: 'gmail',
      helper: 'triage',
      flags: [
        {
          name: 'max',
          value: args.max !== undefined ? String(args.max) : undefined,
          skip: args.max === undefined,
        },
        { name: 'query', value: args.query, skip: args.query === undefined },
        { name: 'labels', boolean: args.labels === true, skip: args.labels !== true },
        { name: 'dry-run', boolean: args.dry_run === true, skip: args.dry_run !== true },
        { name: 'format', value: 'json' },
      ],
      ...(args.account !== undefined ? { account: args.account } : {}),
      ...(args.extra_params !== undefined ? { extraParams: args.extra_params } : {}),
    });

    return invokeVendorHelper({ argv, outputSchema: OutputSchema });
  },
};
