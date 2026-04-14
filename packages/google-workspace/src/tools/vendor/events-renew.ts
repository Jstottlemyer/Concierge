// events_renew — wraps `gws events +renew`. Vendor helper (T11).

import { z } from 'zod/v3';

import type { ToolDef, ToolResult } from '../types.js';
import { buildArgv, invokeVendorHelper } from './helpers.js';

const InputSchema = z
  .object({
    name: z
      .string()
      .optional()
      .describe('Subscription name to reactivate (e.g. subscriptions/SUB_ID).'),
    all: z
      .boolean()
      .optional()
      .describe('Renew every subscription expiring inside the --within window.'),
    within: z
      .string()
      .optional()
      .describe('Time window for --all (e.g. 1h, 30m, 2d).'),
    dry_run: z.boolean().optional(),
    account: z.string().email().optional(),
    extra_params: z.record(z.string()).optional(),
  })
  .refine((v) => v.name !== undefined || v.all === true, {
    message: 'Provide either name or all=true.',
  });

// Shape varies: `--name` returns one subscription object, `--all` returns
// an array of `{ name, renewed }` entries. Passthrough covers both.
const OutputSchema = z.union([
  z
    .object({
      name: z.string().optional(),
      state: z.string().optional(),
      expireTime: z.string().optional(),
    })
    .passthrough(),
  z.array(z.unknown()),
]);

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const eventsRenew: ToolDef<Input, Output> = {
  name: 'events_renew',
  description:
    'Renews or reactivates Google Workspace Events subscriptions before they expire. Pass a specific name to renew one, or all=true with a within window (e.g. 2d) to batch-renew any expiring soon. Use when the user asks to keep an events subscription alive, extend a monitor, or script recurring renewal.',
  service: 'events',
  readonly: false,
  input: InputSchema,
  output: OutputSchema,
  async invoke(args: Input): Promise<ToolResult<Output>> {
    const argv = buildArgv({
      service: 'events',
      helper: 'renew',
      flags: [
        { name: 'name', value: args.name, skip: args.name === undefined },
        { name: 'all', boolean: args.all === true, skip: args.all !== true },
        { name: 'within', value: args.within, skip: args.within === undefined },
        { name: 'dry-run', boolean: args.dry_run === true, skip: args.dry_run !== true },
        { name: 'format', value: 'json' },
      ],
      ...(args.account !== undefined ? { account: args.account } : {}),
      ...(args.extra_params !== undefined ? { extraParams: args.extra_params } : {}),
    });

    return invokeVendorHelper({ argv, outputSchema: OutputSchema });
  },
};
