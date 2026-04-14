// meet_spaces_create — wraps `gws meet spaces create`.

import { z } from 'zod/v3';

import type { ToolDef } from '../types.js';
import {
  mergeParams,
  runGwsJson,
  type ToolContext,
  type ToolResult,
} from './common.js';

export const MeetSpacesCreateInputSchema = z
  .object({
    access_type: z.enum(['OPEN', 'TRUSTED', 'RESTRICTED']).optional(),
    entry_point_access: z.enum(['ALL', 'CREATOR_APP_ONLY']).optional(),
    account: z.string().email().optional(),
    extra_params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type MeetSpacesCreateInput = z.infer<typeof MeetSpacesCreateInputSchema>;

export const MeetSpacesCreateOutputSchema = z
  .object({
    name: z.string().optional(),
    meetingUri: z.string().optional(),
    meetingCode: z.string().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export type MeetSpacesCreateOutput = z.infer<typeof MeetSpacesCreateOutputSchema>;

export const MEET_SPACES_CREATE_DESCRIPTION =
  'Creates a new Google Meet space (meeting room) and returns its joinable URI and meeting code. ' +
  'Use when you need an ad-hoc meeting room to share in a calendar invite, chat message, or email. ' +
  'Access-type defaults to the tenant\'s policy; override with `access_type: OPEN|TRUSTED|RESTRICTED`.';

async function invoke(
  args: MeetSpacesCreateInput,
  _ctx: ToolContext,
): Promise<ToolResult<MeetSpacesCreateOutput>> {
  void _ctx;
  const apiParams = mergeParams({}, args.extra_params);

  const config: Record<string, unknown> = {};
  if (args.access_type !== undefined) config['accessType'] = args.access_type;
  if (args.entry_point_access !== undefined) {
    config['entryPointAccess'] = args.entry_point_access;
  }
  const body: Record<string, unknown> = {};
  if (Object.keys(config).length > 0) body['config'] = config;

  return runGwsJson(
    {
      subcommand: ['meet', 'spaces', 'create'],
      apiParams,
      ...(args.account !== undefined ? { account: args.account } : {}),
      extraArgs: ['--json', JSON.stringify(body)],
    },
    MeetSpacesCreateOutputSchema,
  );
}

export const meetSpacesCreate: ToolDef<MeetSpacesCreateInput, MeetSpacesCreateOutput> = {
  name: 'meet_spaces_create',
  description: MEET_SPACES_CREATE_DESCRIPTION,
  service: 'meet',
  readonly: false,
  input: MeetSpacesCreateInputSchema,
  output: MeetSpacesCreateOutputSchema,
  invoke,
};
