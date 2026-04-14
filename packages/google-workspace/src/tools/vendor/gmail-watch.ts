// gmail_watch — wraps `gws gmail +watch`. Vendor helper (T11). Read-only
// (it only sets up a Pub/Sub subscription and streams; no mailbox mutation).
//
// Output is NDJSON over stdout (one message per line). We surface the raw
// buffers — callers stream/split themselves — because parsing NDJSON into a
// structured schema server-side would buffer indefinitely for --once=false.
// For a single pull (`once: true`) callers can parse the lines themselves.

import { z } from 'zod/v3';

import type { ToolDef, ToolResult } from '../types.js';
import { buildArgv, invokeVendorHelper } from './helpers.js';

const MSG_FORMATS = ['full', 'metadata', 'minimal', 'raw'] as const;

const InputSchema = z.object({
  project: z.string().optional().describe('GCP project ID for Pub/Sub resources.'),
  subscription: z
    .string()
    .optional()
    .describe('Existing Pub/Sub subscription name (skip setup).'),
  topic: z
    .string()
    .optional()
    .describe('Existing Pub/Sub topic with Gmail push permission already granted.'),
  label_ids: z
    .array(z.string())
    .optional()
    .describe('Gmail label IDs to filter (e.g., INBOX, UNREAD).'),
  max_messages: z.number().int().positive().optional().describe('Max messages per pull batch.'),
  poll_interval: z.number().int().positive().optional().describe('Seconds between pulls.'),
  msg_format: z
    .enum(MSG_FORMATS)
    .optional()
    .describe('Gmail message format.'),
  once: z.boolean().optional().describe('Pull once and exit.'),
  cleanup: z.boolean().optional().describe('Delete created Pub/Sub resources on exit.'),
  output_dir: z
    .string()
    .optional()
    .describe('Write each message to a separate JSON file in this directory.'),
  dry_run: z.boolean().optional(),
  account: z.string().email().optional(),
  extra_params: z.record(z.string()).optional(),
});

const OutputSchema = z.object({
  stdout: z.string().describe('Raw NDJSON stream from the helper (one message per line).'),
  stderr: z.string(),
});

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const gmailWatch: ToolDef<Input, Output> = {
  name: 'gmail_watch',
  description:
    "Watches for new Gmail messages via a Pub/Sub subscription and streams them as NDJSON. Use when the user wants to monitor incoming mail (one-shot or long-running) or set up a persistent push subscription. For one-off reading or searching of existing email, prefer claude.ai's hosted Gmail connector.",
  service: 'gmail',
  readonly: true,
  input: InputSchema,
  output: OutputSchema,
  async invoke(args: Input): Promise<ToolResult<Output>> {
    const argv = buildArgv({
      service: 'gmail',
      helper: 'watch',
      flags: [
        { name: 'project', value: args.project, skip: args.project === undefined },
        {
          name: 'subscription',
          value: args.subscription,
          skip: args.subscription === undefined,
        },
        { name: 'topic', value: args.topic, skip: args.topic === undefined },
        {
          name: 'label-ids',
          value: args.label_ids?.join(','),
          skip: args.label_ids === undefined || args.label_ids.length === 0,
        },
        {
          name: 'max-messages',
          value: args.max_messages !== undefined ? String(args.max_messages) : undefined,
          skip: args.max_messages === undefined,
        },
        {
          name: 'poll-interval',
          value: args.poll_interval !== undefined ? String(args.poll_interval) : undefined,
          skip: args.poll_interval === undefined,
        },
        {
          name: 'msg-format',
          value: args.msg_format,
          skip: args.msg_format === undefined,
        },
        { name: 'once', boolean: args.once === true, skip: args.once !== true },
        { name: 'cleanup', boolean: args.cleanup === true, skip: args.cleanup !== true },
        {
          name: 'output-dir',
          value: args.output_dir,
          skip: args.output_dir === undefined,
        },
        { name: 'dry-run', boolean: args.dry_run === true, skip: args.dry_run !== true },
        { name: 'format', value: 'json' },
      ],
      ...(args.account !== undefined ? { account: args.account } : {}),
      ...(args.extra_params !== undefined ? { extraParams: args.extra_params } : {}),
    });

    return invokeVendorHelper({ argv, outputSchema: OutputSchema, parseOutput: 'raw' });
  },
};
