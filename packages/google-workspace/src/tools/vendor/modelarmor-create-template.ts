// modelarmor_create_template — wraps `gws modelarmor +create-template`.

import { z } from 'zod/v3';

import type { ToolDef, ToolResult } from '../types.js';
import { buildArgv, invokeVendorHelper } from './helpers.js';

const PRESETS = ['jailbreak'] as const;

const InputSchema = z.object({
  project: z.string().min(1).describe('GCP project ID.'),
  location: z.string().min(1).describe('GCP location (e.g. us-central1).'),
  template_id: z.string().min(1).describe('Template ID to create.'),
  preset: z
    .enum(PRESETS)
    .optional()
    .describe('Preset template configuration.'),
  json: z
    .string()
    .optional()
    .describe('JSON body for the template configuration (overrides preset).'),
  dry_run: z.boolean().optional(),
  account: z.string().email().optional(),
  extra_params: z.record(z.string()).optional(),
});

const OutputSchema = z
  .object({
    name: z.string().optional(),
    createTime: z.string().optional(),
    updateTime: z.string().optional(),
    filterConfig: z.unknown().optional(),
  })
  .passthrough();

type Input = z.infer<typeof InputSchema>;
type Output = z.infer<typeof OutputSchema>;

export const modelarmorCreateTemplate: ToolDef<Input, Output> = {
  name: 'modelarmor_create_template',
  description:
    "Creates a new Model Armor sanitization template in the specified GCP project and location. Accepts a named preset (e.g. 'jailbreak') or a raw JSON filter config. Use when the user wants to bootstrap Model Armor protection for their project before calling modelarmor_sanitize_prompt or modelarmor_sanitize_response. Returns the created template's resource name.",
  service: 'modelarmor',
  readonly: false,
  input: InputSchema,
  output: OutputSchema,
  async invoke(args: Input): Promise<ToolResult<Output>> {
    const argv = buildArgv({
      service: 'modelarmor',
      helper: 'create-template',
      flags: [
        { name: 'project', value: args.project },
        { name: 'location', value: args.location },
        { name: 'template-id', value: args.template_id },
        { name: 'preset', value: args.preset, skip: args.preset === undefined },
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
