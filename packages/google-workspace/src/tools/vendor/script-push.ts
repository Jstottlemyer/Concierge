// script_push — wraps `gws script +push`. Vendor helper (T11).

import { z } from 'zod/v3';

import type { ToolDef, ToolResult } from '../types.js';
import { buildArgv, invokeVendorHelper } from './helpers.js';

const InputSchema = z.object({
  script: z.string().min(1).describe('Apps Script Project ID.'),
  dir: z.string().optional().describe('Directory containing script files (defaults to cwd).'),
  dry_run: z.boolean().optional(),
  account: z.string().email().optional(),
  extra_params: z.record(z.string()).optional(),
});

const OutputSchema = z
  .object({
    scriptId: z.string().optional(),
    files: z.array(z.unknown()).optional(),
  })
  .passthrough();

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const scriptPush: ToolDef<Input, Output> = {
  name: 'script_push',
  description:
    'Pushes local Apps Script source files (.gs, .js, .html, appsscript.json) from a directory up to an existing Apps Script project, replacing ALL remote files. Use when the user asks to deploy, sync, or publish their local Apps Script code. Skips hidden files and node_modules. This is destructive — all remote files are overwritten.',
  service: 'script',
  readonly: false,
  input: InputSchema,
  output: OutputSchema,
  async invoke(args: Input): Promise<ToolResult<Output>> {
    const argv = buildArgv({
      service: 'script',
      helper: 'push',
      flags: [
        { name: 'script', value: args.script },
        { name: 'dir', value: args.dir, skip: args.dir === undefined },
        { name: 'dry-run', boolean: args.dry_run === true, skip: args.dry_run !== true },
        { name: 'format', value: 'json' },
      ],
      ...(args.account !== undefined ? { account: args.account } : {}),
      ...(args.extra_params !== undefined ? { extraParams: args.extra_params } : {}),
    });

    return invokeVendorHelper({ argv, outputSchema: OutputSchema });
  },
};
