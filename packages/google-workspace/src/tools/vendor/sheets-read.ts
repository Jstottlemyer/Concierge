// sheets_read — wraps `gws sheets +read`. Vendor helper (T11). Read-only.

import { z } from 'zod/v3';

import type { ToolDef, ToolResult } from '../types.js';
import { buildArgv, invokeVendorHelper } from './helpers.js';

const InputSchema = z.object({
  spreadsheet: z.string().min(1).describe('Spreadsheet ID.'),
  range: z.string().min(1).describe("Range to read (e.g. 'Sheet1!A1:B2' or 'Sheet1')."),
  dry_run: z.boolean().optional(),
  account: z.string().email().optional(),
  extra_params: z.record(z.string()).optional(),
});

// values.get shape: { range, majorDimension, values: [[...]] }
const OutputSchema = z
  .object({
    range: z.string().optional(),
    majorDimension: z.string().optional(),
    values: z.array(z.array(z.unknown())).optional(),
  })
  .passthrough();

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const sheetsRead: ToolDef<Input, Output> = {
  name: 'sheets_read',
  description:
    'Reads cell values from a Google Sheets spreadsheet over the given A1 range (e.g., "Sheet1!A1:D10"). Read-only — never modifies the spreadsheet. Use when the user asks for the contents, headers, or specific cells of a sheet they own or have access to.',
  service: 'sheets',
  readonly: true,
  input: InputSchema,
  output: OutputSchema,
  async invoke(args: Input): Promise<ToolResult<Output>> {
    const argv = buildArgv({
      service: 'sheets',
      helper: 'read',
      flags: [
        { name: 'spreadsheet', value: args.spreadsheet },
        { name: 'range', value: args.range },
        { name: 'dry-run', boolean: args.dry_run === true, skip: args.dry_run !== true },
        { name: 'format', value: 'json' },
      ],
      ...(args.account !== undefined ? { account: args.account } : {}),
      ...(args.extra_params !== undefined ? { extraParams: args.extra_params } : {}),
    });

    return invokeVendorHelper({ argv, outputSchema: OutputSchema });
  },
};
