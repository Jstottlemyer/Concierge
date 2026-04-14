// set_read_only — management tool (T14), confirmation-guarded on toggle-off.
//
// Toggles the per-account Read-Only flag in state.json. Enabling (safer) is
// a one-call operation. Disabling (less safe — re-enables writes) requires a
// human-typed confirmation phrase `enable writes for <account>`.
//
// The actual Read-Only enforcement lives in T17 middleware: when `enabled`
// is true for an account, any tool with `readonly: false` returns
// `read_only_active`. This tool only flips the flag; it does not gate tool
// dispatch itself.
//
// v1 scope-upgrade note: per the spec, toggling off may eventually require
// re-consenting to writable scopes if the account's current grants are
// `.readonly` variants. For v1 we just flip the flag — scope-upgrade
// re-consent is a follow-up (documented in spec §Read-Only mode).

import { z } from 'zod/v3';

import { buildConfirmationRequiredResponse } from '../../confirmation/response.js';
import { verifyConfirmation } from '../../confirmation/phrases.js';
import { makeError } from '@concierge/core/errors';
import { loadState, normalizeEmail, writeState } from '../../state/loader.js';
import type { ToolContext, ToolDef, ToolResult } from '../types.js';

export const SetReadOnlyInputSchema = z
  .object({
    enabled: z.boolean(),
    account: z.string().email().optional(),
    confirm: z.string().optional(),
  })
  .strict();

export type SetReadOnlyInput = z.infer<typeof SetReadOnlyInputSchema>;

export const SetReadOnlyOutputSchema = z
  .object({
    account: z.string().email(),
    read_only: z.boolean(),
  })
  .strict();

export type SetReadOnlyOutput = z.infer<typeof SetReadOnlyOutputSchema>;

export const SET_READ_ONLY_DESCRIPTION =
  'Toggles Read-Only mode for a connected Google account (or the default account if `account` ' +
  'is omitted). When enabled, any write/delete/grant tool returns read_only_active. Use when ' +
  'the user wants to temporarily pause writes to a Google account without disconnecting it. ' +
  'Enabling is immediate; disabling requires a human-typed confirmation phrase. For fully ' +
  'removing an account, prefer remove_account.';

async function invoke(
  args: SetReadOnlyInput,
  _ctx: ToolContext,
): Promise<ToolResult<SetReadOnlyOutput>> {
  void _ctx;

  const state = await loadState();

  // Resolve target account: explicit `account` wins, else default.
  let target: string;
  if (args.account !== undefined && args.account.length > 0) {
    target = normalizeEmail(args.account);
  } else if (state.default_account !== null) {
    target = state.default_account;
  } else {
    return {
      ok: false,
      error: makeError({
        error_code: 'validation_error',
        message:
          `No default account is set and no account was provided. Pass account: "<email>" ` +
          `or set_default_account first.`,
      }),
    };
  }

  if (!(target in state.accounts)) {
    return {
      ok: false,
      error: makeError({
        error_code: 'validation_error',
        message:
          `Account "${target}" is not connected to Concierge. ` +
          `Run any tool with account: "${target}" to sign in first.`,
      }),
    };
  }

  // Toggle-off confirmation gate. Enabling (true) has no phrase.
  if (args.enabled === false) {
    if (args.confirm === undefined) {
      const warning =
        `Disabling Read-Only for ${target} re-enables writes to this account's Google data. ` +
        `If the current grant is a ".readonly" scope variant, the next write will trigger a ` +
        `re-consent prompt for writable scopes. Type the phrase below to proceed.`;
      return {
        ok: false,
        error: buildConfirmationRequiredResponse(
          'set_read_only_off',
          { account: target },
          warning,
        ),
      };
    }
    const verified = verifyConfirmation('set_read_only_off', { account: target }, args.confirm);
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

  const nextAccounts: Record<string, { read_only: boolean }> = {
    ...state.accounts,
    [target]: { read_only: args.enabled },
  };

  await writeState({
    state_schema_version: state.state_schema_version,
    default_account: state.default_account,
    accounts: nextAccounts,
  });

  return {
    ok: true,
    data: {
      account: target,
      read_only: args.enabled,
    },
  };
}

export const setReadOnly: ToolDef<SetReadOnlyInput, SetReadOnlyOutput> = {
  name: 'set_read_only',
  description: SET_READ_ONLY_DESCRIPTION,
  service: 'management',
  readonly: false,
  input: SetReadOnlyInputSchema,
  output: SetReadOnlyOutputSchema,
  invoke,
};
