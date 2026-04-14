// drive_permissions_create — wraps `gws drive permissions create`.
//
// Per plan Decision #3 and Open Q#3, sharing to a different domain than the
// source (authenticated) account requires a human-typed `confirm` phrase
// matching `share with <target_email>` (canonical phrase from
// src/confirmation/phrases.ts). Same-domain shares proceed without.
//
// Source-domain resolution:
//   - `args.account` if supplied (explicit caller override).
//   - Otherwise `state.default_account`.
//   - If neither is known, we treat it as a same-domain call (we can't
//     compute a cross-domain check without a source); that's safer than
//     blocking the entire write flow when state is uninitialized.

import { z } from 'zod/v3';

import type { ToolDef } from '../types.js';
import {
  emailDomain,
  mergeParams,
  runGwsJson,
  type ToolContext,
  type ToolResult,
} from './common.js';
import { loadState } from '../../state/loader.js';
import { buildConfirmationRequiredResponse } from '../../confirmation/response.js';
import { verifyConfirmation } from '../../confirmation/phrases.js';
import { makeError } from '@concierge/core/errors';

export const DRIVE_PERMISSION_ROLES = ['reader', 'commenter', 'writer', 'fileOrganizer', 'organizer', 'owner'] as const;

export const DrivePermissionsCreateInputSchema = z
  .object({
    file_id: z.string().min(1),
    email: z.string().email(),
    role: z.enum(DRIVE_PERMISSION_ROLES),
    type: z.enum(['user', 'group', 'domain']).optional(),
    send_notification_email: z.boolean().optional(),
    confirm: z.string().optional(),
    account: z.string().email().optional(),
    extra_params: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type DrivePermissionsCreateInput = z.infer<typeof DrivePermissionsCreateInputSchema>;

export const DrivePermissionsCreateOutputSchema = z
  .object({
    id: z.string().optional(),
    type: z.string().optional(),
    role: z.string().optional(),
    emailAddress: z.string().optional(),
    kind: z.string().optional(),
  })
  .passthrough();

export type DrivePermissionsCreateOutput = z.infer<typeof DrivePermissionsCreateOutputSchema>;

export const DRIVE_PERMISSIONS_CREATE_DESCRIPTION =
  'Creates a sharing permission on a Drive file or folder (grants a role to a user, group, or domain). ' +
  'Use when you need to programmatically share Drive content. Cross-domain shares require a ' +
  'typed confirmation phrase matching `share with <target_email>` per the Concierge safety policy.';

/**
 * Resolve the source account email:
 *   1. explicit `args.account` if present
 *   2. state.default_account
 *   3. null (callers interpret null as "cannot compute domain comparison")
 */
async function resolveSourceAccount(args: DrivePermissionsCreateInput): Promise<string | null> {
  if (args.account !== undefined && args.account.length > 0) {
    return args.account;
  }
  try {
    const state = await loadState();
    return state.default_account;
  } catch {
    return null;
  }
}

async function invoke(
  args: DrivePermissionsCreateInput,
  _ctx: ToolContext,
): Promise<ToolResult<DrivePermissionsCreateOutput>> {
  void _ctx;

  const source = await resolveSourceAccount(args);
  const sourceDomain = source !== null ? emailDomain(source) : null;
  const targetDomain = emailDomain(args.email);

  // Cross-domain detection. If the source domain is unknown, we defensively
  // do NOT require confirmation — there's no mismatch to detect.
  const crossDomain =
    sourceDomain !== null &&
    sourceDomain.length > 0 &&
    targetDomain.length > 0 &&
    sourceDomain !== targetDomain;

  if (crossDomain) {
    if (args.confirm === undefined) {
      return {
        ok: false,
        error: buildConfirmationRequiredResponse(
          'drive_permissions_create_cross_domain',
          { email: args.email },
          `Sharing "${args.file_id}" with ${args.email} (different domain than your account). Type the confirmation phrase to proceed.`,
        ),
      };
    }
    const verified = verifyConfirmation(
      'drive_permissions_create_cross_domain',
      { email: args.email },
      args.confirm,
    );
    if (!verified.match) {
      return {
        ok: false,
        error: makeError({
          error_code: 'confirmation_mismatch',
          message: `Confirmation phrase did not match. Type exactly: ${verified.required}`,
          confirmation_phrase: verified.required,
        }),
      };
    }
  }

  // Build params (URL/query) and --json body. Google Drive permissions.create
  // requires `fileId` in params and the permission resource in the body.
  const paramsSurfaced: Record<string, unknown> = {
    fileId: args.file_id,
    sendNotificationEmail: args.send_notification_email ?? true,
  };
  const apiParams = mergeParams(paramsSurfaced, args.extra_params);

  const body: Record<string, unknown> = {
    role: args.role,
    type: args.type ?? 'user',
    emailAddress: args.email,
  };

  return runGwsJson(
    {
      subcommand: ['drive', 'permissions', 'create'],
      apiParams,
      ...(args.account !== undefined ? { account: args.account } : {}),
      extraArgs: ['--json', JSON.stringify(body)],
    },
    DrivePermissionsCreateOutputSchema,
  );
}

export const drivePermissionsCreate: ToolDef<
  DrivePermissionsCreateInput,
  DrivePermissionsCreateOutput
> = {
  name: 'drive_permissions_create',
  description: DRIVE_PERMISSIONS_CREATE_DESCRIPTION,
  service: 'drive',
  readonly: false,
  input: DrivePermissionsCreateInputSchema,
  output: DrivePermissionsCreateOutputSchema,
  invoke,
};
