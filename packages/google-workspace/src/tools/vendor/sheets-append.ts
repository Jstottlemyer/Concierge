// sheets_append — wraps `gws sheets +append`. Vendor helper (T11).

import { z } from 'zod/v3';

import type { ToolDef, ToolResult } from '../types.js';
import { buildArgv, invokeVendorHelper } from './helpers.js';

const InputSchema = z
  .object({
    spreadsheet: z.string().min(1).describe('Spreadsheet ID.'),
    values: z
      .array(z.string())
      .optional()
      .describe('Simple single-row values (comma-joined into --values).'),
    json_values: z
      .array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])))
      .optional()
      .describe('JSON array of rows for multi-row inserts.'),
    dry_run: z.boolean().optional(),
    account: z.string().email().optional(),
    extra_params: z.record(z.string()).optional(),
  })
  .refine((v) => v.values !== undefined || v.json_values !== undefined, {
    message: 'Either values or json_values must be provided.',
  });

const OutputSchema = z
  .object({
    spreadsheetId: z.string().optional(),
    updates: z.unknown().optional(),
  })
  .passthrough();

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const sheetsAppend: ToolDef<Input, Output> = {
  name: 'sheets_append',
  description:
    'Appends one or more rows to a Google Sheets spreadsheet. Accepts either a simple comma-joined value list for a single row or a JSON matrix for multi-row inserts. Use when the user asks to add a row, log data, or bulk-insert into an existing spreadsheet. Returns the updated range metadata.',
  service: 'sheets',
  readonly: false,
  input: InputSchema,
  output: OutputSchema,
  async invoke(args: Input): Promise<ToolResult<Output>> {
    const argv = buildArgv({
      service: 'sheets',
      helper: 'append',
      flags: [
        { name: 'spreadsheet', value: args.spreadsheet },
        {
          name: 'values',
          value: args.values?.join(','),
          skip: args.values === undefined,
        },
        {
          name: 'json-values',
          value: args.json_values !== undefined ? JSON.stringify(args.json_values) : undefined,
          skip: args.json_values === undefined,
        },
        { name: 'dry-run', boolean: args.dry_run === true, skip: args.dry_run !== true },
        { name: 'format', value: 'json' },
      ],
      ...(args.account !== undefined ? { account: args.account } : {}),
      ...(args.extra_params !== undefined ? { extraParams: args.extra_params } : {}),
    });

    return invokeVendorHelper({ argv, outputSchema: OutputSchema });
  },
};
