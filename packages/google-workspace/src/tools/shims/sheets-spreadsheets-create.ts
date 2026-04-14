// sheets_spreadsheets_create — wraps `gws sheets spreadsheets create`.

import { z } from 'zod/v3';

import type { ToolDef } from '../types.js';
import {
  mergeParams,
  runGwsJson,
  type ToolContext,
  type ToolResult,
} from './common.js';

export const SheetsSpreadsheetsCreateInputSchema = z
  .object({
    title: z.string().min(1),
    locale: z.string().optional(),
    time_zone: z.string().optional(),
    account: z.string().email().optional(),
    extra_params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type SheetsSpreadsheetsCreateInput = z.infer<typeof SheetsSpreadsheetsCreateInputSchema>;

export const SheetsSpreadsheetsCreateOutputSchema = z
  .object({
    spreadsheetId: z.string().optional(),
    spreadsheetUrl: z.string().optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    sheets: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough();

export type SheetsSpreadsheetsCreateOutput = z.infer<typeof SheetsSpreadsheetsCreateOutputSchema>;

export const SHEETS_SPREADSHEETS_CREATE_DESCRIPTION =
  'Creates a new Google Sheet with the given title via the Sheets API. ' +
  'Use when you need a fresh spreadsheet to populate via Sheets batch-update or the ' +
  '`gws sheets +append` helper. The returned `spreadsheetId` is stable; cell data is added separately.';

async function invoke(
  args: SheetsSpreadsheetsCreateInput,
  _ctx: ToolContext,
): Promise<ToolResult<SheetsSpreadsheetsCreateOutput>> {
  void _ctx;
  const apiParams = mergeParams({}, args.extra_params);
  const properties: Record<string, unknown> = { title: args.title };
  if (args.locale !== undefined) properties['locale'] = args.locale;
  if (args.time_zone !== undefined) properties['timeZone'] = args.time_zone;
  const body = { properties };

  return runGwsJson(
    {
      subcommand: ['sheets', 'spreadsheets', 'create'],
      apiParams,
      ...(args.account !== undefined ? { account: args.account } : {}),
      extraArgs: ['--json', JSON.stringify(body)],
    },
    SheetsSpreadsheetsCreateOutputSchema,
  );
}

export const sheetsSpreadsheetsCreate: ToolDef<
  SheetsSpreadsheetsCreateInput,
  SheetsSpreadsheetsCreateOutput
> = {
  name: 'sheets_spreadsheets_create',
  description: SHEETS_SPREADSHEETS_CREATE_DESCRIPTION,
  service: 'sheets',
  readonly: false,
  input: SheetsSpreadsheetsCreateInputSchema,
  output: SheetsSpreadsheetsCreateOutputSchema,
  invoke,
};
