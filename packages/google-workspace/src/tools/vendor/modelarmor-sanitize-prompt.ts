// modelarmor_sanitize_prompt — wraps `gws modelarmor +sanitize-prompt`. Read-only.

import { z } from 'zod/v3';

import type { ToolDef, ToolResult } from '../types.js';
import { buildArgv, invokeVendorHelper } from './helpers.js';

const InputSchema = z
  .object({
    template: z
      .string()
      .min(1)
      .describe('Full template resource name (projects/.../locations/.../templates/...).'),
    text: z.string().optional().describe('Text content to sanitize.'),
    json: z.string().optional().describe('Full JSON request body (overrides text).'),
    dry_run: z.boolean().optional(),
    account: z.string().email().optional(),
    extra_params: z.record(z.string()).optional(),
  })
  .refine((v) => v.text !== undefined || v.json !== undefined, {
    message: 'Provide either text or json.',
  });

const OutputSchema = z
  .object({
    sanitizationResult: z.unknown().optional(),
    filterMatchState: z.string().optional(),
    invocationResult: z.string().optional(),
  })
  .passthrough();

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const modelarmorSanitizePrompt: ToolDef<Input, Output> = {
  name: 'modelarmor_sanitize_prompt',
  description:
    'Sends an inbound user prompt through a Model Armor sanitization template, returning a filter match state and sanitized result. Read-only — does not persist. Use when the user wants to screen input for jailbreaks, PII, or unsafe content before passing it to a model. For outbound model output, use modelarmor_sanitize_response.',
  service: 'modelarmor',
  readonly: true,
  input: InputSchema,
  output: OutputSchema,
  async invoke(args: Input): Promise<ToolResult<Output>> {
    const argv = buildArgv({
      service: 'modelarmor',
      helper: 'sanitize-prompt',
      flags: [
        { name: 'template', value: args.template },
        { name: 'text', value: args.text, skip: args.text === undefined },
        { name: 'json', value: args.json, skip: args.json === undefined },
        { name: 'dry-run', boolean: args.dry_run === true, skip: args.dry_run !== true },
        { name: 'format', value: 'json' },
      ],
      ...(args.account !== undefined ? { account: args.account } : {}),
      ...(args.extra_params !== undefined ? { extraParams: args.extra_params } : {}),
    });

    return invokeVendorHelper({ argv, outputSchema: OutputSchema });
  },
};
