// chat_send — wraps `gws chat +send`. Vendor helper (T11).

import { z } from 'zod/v3';

import type { ToolDef, ToolResult } from '../types.js';
import { buildArgv, invokeVendorHelper } from './helpers.js';

const InputSchema = z.object({
  space: z.string().min(1).describe('Chat space resource name (e.g. spaces/AAAA...).'),
  text: z.string().describe('Plain-text message to send.'),
  dry_run: z.boolean().optional(),
  account: z.string().email().optional(),
  extra_params: z.record(z.string()).optional(),
});

const OutputSchema = z
  .object({
    name: z.string().optional(),
    sender: z.unknown().optional(),
    createTime: z.string().optional(),
    text: z.string().optional(),
  })
  .passthrough();

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const chatSend: ToolDef<Input, Output> = {
  name: 'chat_send',
  description:
    'Posts a plain-text message to a Google Chat space the authenticated account can access. Use when the user asks to send a chat message, ping a room, or announce something to a space they have identified by name (spaces/...). For cards, threaded replies, or rich formatting, the raw Chat API is required.',
  service: 'chat',
  readonly: false,
  input: InputSchema,
  output: OutputSchema,
  async invoke(args: Input): Promise<ToolResult<Output>> {
    const argv = buildArgv({
      service: 'chat',
      helper: 'send',
      flags: [
        { name: 'space', value: args.space },
        { name: 'text', value: args.text },
        { name: 'dry-run', boolean: args.dry_run === true, skip: args.dry_run !== true },
        { name: 'format', value: 'json' },
      ],
      ...(args.account !== undefined ? { account: args.account } : {}),
      ...(args.extra_params !== undefined ? { extraParams: args.extra_params } : {}),
    });

    return invokeVendorHelper({ argv, outputSchema: OutputSchema });
  },
};
