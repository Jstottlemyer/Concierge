// docs_write — wraps `gws docs +write`. Vendor helper (T11).

import { z } from 'zod/v3';

import type { ToolDef, ToolResult } from '../types.js';
import { buildArgv, invokeVendorHelper } from './helpers.js';

const InputSchema = z.object({
  document: z.string().min(1).describe('Google Doc document ID.'),
  text: z.string().describe('Plain text to append at the end of the document body.'),
  dry_run: z.boolean().optional(),
  account: z.string().email().optional(),
  extra_params: z.record(z.string()).optional(),
});

const OutputSchema = z
  .object({
    documentId: z.string().optional(),
    replies: z.array(z.unknown()).optional(),
    writeControl: z.unknown().optional(),
  })
  .passthrough();

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const docsWrite: ToolDef<Input, Output> = {
  name: 'docs_write',
  description:
    'Appends plain text to the end of a Google Doc identified by document ID. Use when the user asks to add a note, log an update, or append content to an existing document. For rich formatting (bold, lists, headings), the raw batchUpdate API is required — this helper only supports plain text.',
  service: 'docs',
  readonly: false,
  input: InputSchema,
  output: OutputSchema,
  async invoke(args: Input): Promise<ToolResult<Output>> {
    const argv = buildArgv({
      service: 'docs',
      helper: 'write',
      flags: [
        { name: 'document', value: args.document },
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
