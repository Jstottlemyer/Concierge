// events_subscribe — wraps `gws events +subscribe`. Vendor helper (T11).
// Output is NDJSON — we surface raw stdout/stderr like gmail_watch.

import { z } from 'zod/v3';

import type { ToolDef, ToolResult } from '../types.js';
import { buildArgv, invokeVendorHelper } from './helpers.js';

const InputSchema = z.object({
  target: z.string().optional().describe('Workspace resource URI (e.g. //chat.googleapis.com/spaces/SPACE).'),
  event_types: z
    .array(z.string())
    .optional()
    .describe('CloudEvents types to subscribe to.'),
  project: z.string().optional().describe('GCP project ID for Pub/Sub resources.'),
  subscription: z
    .string()
    .optional()
    .describe('Existing Pub/Sub subscription name (skip setup).'),
  max_messages: z.number().int().positive().optional(),
  poll_interval: z.number().int().positive().optional(),
  once: z.boolean().optional().describe('Pull once and exit.'),
  cleanup: z.boolean().optional(),
  no_ack: z.boolean().optional().describe("Don't auto-acknowledge messages."),
  output_dir: z.string().optional(),
  dry_run: z.boolean().optional(),
  account: z.string().email().optional(),
  extra_params: z.record(z.string()).optional(),
});

const OutputSchema = z.object({
  stdout: z.string(),
  stderr: z.string(),
});

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const eventsSubscribe: ToolDef<Input, Output> = {
  name: 'events_subscribe',
  description:
    'Subscribes to Google Workspace CloudEvents (chat.message.created, drive.file.updated, etc.) and streams them as NDJSON via a Pub/Sub pull subscription. Creates or reuses Pub/Sub resources. Use when the user asks to monitor Workspace activity, tail Chat messages, or react to Drive/Calendar changes. Write operation — provisions Pub/Sub resources unless --subscription is reused.',
  service: 'events',
  readonly: false,
  input: InputSchema,
  output: OutputSchema,
  async invoke(args: Input): Promise<ToolResult<Output>> {
    const argv = buildArgv({
      service: 'events',
      helper: 'subscribe',
      flags: [
        { name: 'target', value: args.target, skip: args.target === undefined },
        {
          name: 'event-types',
          value: args.event_types?.join(','),
          skip: args.event_types === undefined || args.event_types.length === 0,
        },
        { name: 'project', value: args.project, skip: args.project === undefined },
        {
          name: 'subscription',
          value: args.subscription,
          skip: args.subscription === undefined,
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
        { name: 'once', boolean: args.once === true, skip: args.once !== true },
        { name: 'cleanup', boolean: args.cleanup === true, skip: args.cleanup !== true },
        { name: 'no-ack', boolean: args.no_ack === true, skip: args.no_ack !== true },
        { name: 'output-dir', value: args.output_dir, skip: args.output_dir === undefined },
        { name: 'dry-run', boolean: args.dry_run === true, skip: args.dry_run !== true },
        { name: 'format', value: 'json' },
      ],
      ...(args.account !== undefined ? { account: args.account } : {}),
      ...(args.extra_params !== undefined ? { extraParams: args.extra_params } : {}),
    });

    return invokeVendorHelper({ argv, outputSchema: OutputSchema, parseOutput: 'raw' });
  },
};
