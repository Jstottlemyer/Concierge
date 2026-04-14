// set_default_account — management tool (T14).
//
// Changes `state.default_account` to the supplied email. Rejects if the email
// does not already appear in `state.accounts` — we won't mint a fresh default
// for an account that hasn't been through sign-in (consent flow establishes
// the account's state entry on first successful grant).

import { z } from 'zod/v3';

import { loadState, normalizeEmail, writeState } from '../../state/loader.js';
import { makeError } from '@concierge/core/errors';
import type { ToolContext, ToolDef, ToolResult } from '../types.js';

export const SetDefaultAccountInputSchema = z
  .object({
    email: z.string().email(),
  })
  .strict();

export type SetDefaultAccountInput = z.infer<typeof SetDefaultAccountInputSchema>;

export const SetDefaultAccountOutputSchema = z
  .object({
    default_account: z.string().email(),
  })
  .strict();

export type SetDefaultAccountOutput = z.infer<typeof SetDefaultAccountOutputSchema>;

export const SET_DEFAULT_ACCOUNT_DESCRIPTION =
  'Sets which connected Google account is treated as the default for tool calls that omit ' +
  'the `account` argument. Use when the user wants to switch between multiple authenticated ' +
  'accounts (e.g., personal vs. work) without passing `account` on every tool call. The target ' +
  'email must already be connected — for adding a new account, prefer running any tool with ' +
  'that email as `account` so Concierge triggers sign-in automatically.';

async function invoke(
  args: SetDefaultAccountInput,
  _ctx: ToolContext,
): Promise<ToolResult<SetDefaultAccountOutput>> {
  void _ctx;

  const email = normalizeEmail(args.email);
  const state = await loadState();

  if (!(email in state.accounts)) {
    return {
      ok: false,
      error: makeError({
        error_code: 'validation_error',
        message:
          `Account "${email}" is not connected to Concierge. Run a tool with ` +
          `account: "${email}" to sign in first, then retry set_default_account.`,
      }),
    };
  }

  await writeState({
    state_schema_version: state.state_schema_version,
    default_account: email,
    accounts: state.accounts,
  });

  return {
    ok: true,
    data: { default_account: email },
  };
}

export const setDefaultAccount: ToolDef<SetDefaultAccountInput, SetDefaultAccountOutput> = {
  name: 'set_default_account',
  description: SET_DEFAULT_ACCOUNT_DESCRIPTION,
  service: 'management',
  readonly: false,
  input: SetDefaultAccountInputSchema,
  output: SetDefaultAccountOutputSchema,
  invoke,
};
