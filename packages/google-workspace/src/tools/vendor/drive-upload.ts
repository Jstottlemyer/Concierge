// drive_upload — wraps `gws drive +upload`. Vendor helper (T11).
//
// The vendor CLI takes the file path as a positional arg (not a --flag), so
// this is the one tool in the batch that uses `positionals` in buildArgv.

import { z } from 'zod/v3';

import type { ToolDef, ToolResult } from '../types.js';
import { buildArgv, invokeVendorHelper } from './helpers.js';

const InputSchema = z.object({
  file: z.string().min(1).describe('Local path of the file to upload.'),
  parent: z.string().optional().describe('Parent folder ID in Drive.'),
  name: z.string().optional().describe('Target filename (defaults to the source filename).'),
  dry_run: z.boolean().optional(),
  account: z.string().email().optional(),
  extra_params: z.record(z.string()).optional(),
});

const OutputSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    mimeType: z.string().optional(),
    parents: z.array(z.string()).optional(),
    webViewLink: z.string().optional(),
  })
  .passthrough();

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const driveUpload: ToolDef<Input, Output> = {
  name: 'drive_upload',
  description:
    'Uploads a local file to Google Drive with automatic MIME type detection, optional parent folder placement, and optional custom target name. Use when the user wants to put a specific local file into Drive. Returns the created file metadata including the Drive file ID and web view link.',
  service: 'drive',
  readonly: false,
  input: InputSchema,
  output: OutputSchema,
  async invoke(args: Input): Promise<ToolResult<Output>> {
    const argv = buildArgv({
      service: 'drive',
      helper: 'upload',
      positionals: [args.file],
      flags: [
        { name: 'parent', value: args.parent, skip: args.parent === undefined },
        { name: 'name', value: args.name, skip: args.name === undefined },
        { name: 'dry-run', boolean: args.dry_run === true, skip: args.dry_run !== true },
        { name: 'format', value: 'json' },
      ],
      ...(args.account !== undefined ? { account: args.account } : {}),
      ...(args.extra_params !== undefined ? { extraParams: args.extra_params } : {}),
    });

    return invokeVendorHelper({ argv, outputSchema: OutputSchema });
  },
};
