// remove_account — management tool (T14), confirmation-guarded.
//
// Per spec.md §Management tools / §Destructive operations, removing an account
// both revokes Google-side access (best-effort; warn but continue on failure)
// and deletes local credentials + state entry. The user must type the exact
// phrase `remove <email>` as the `confirm` parameter; without it we return a
// `confirmation_required` envelope.

import { z } from 'zod/v3';

import { __resetCachesForTests as invalidateGrantedCaches } from '../../auth/granted-bundles.js';
import { buildConfirmationRequiredResponse } from '../../confirmation/response.js';
import { verifyConfirmation } from '../../confirmation/phrases.js';
import { makeError } from '@concierge/core/errors';
import { runGws } from '../../gws/runner.js';
import { loadState, normalizeEmail, writeState } from '../../state/loader.js';
import type { ToolContext, ToolDef, ToolResult } from '../types.js';

export const RemoveAccountInputSchema = z
  .object({
    email: z.string().email(),
    confirm: z.string().optional(),
  })
  .strict();

export type RemoveAccountInput = z.infer<typeof RemoveAccountInputSchema>;

export const RemoveAccountOutputSchema = z
  .object({
    removed_email: z.string().email(),
    revoke_ok: z.boolean(),
    logout_ok: z.boolean(),
    new_default_account: z.string().email().nullable(),
  })
  .strict();

export type RemoveAccountOutput = z.infer<typeof RemoveAccountOutputSchema>;

export const REMOVE_ACCOUNT_DESCRIPTION =
  'Removes a Google account from Concierge: revokes Google-side access and deletes saved ' +
  'credentials from the macOS Keychain. Irreversible. Use when the user explicitly asks to ' +
  'disconnect or remove an account. Requires a human-typed confirmation phrase on the second ' +
  'call — the first call returns the required phrase and does not delete anything. For ' +
  'temporarily pausing writes without removing the account, prefer set_read_only.';

async function invoke(
  args: RemoveAccountInput,
  _ctx: ToolContext,
): Promise<ToolResult<RemoveAccountOutput>> {
  void _ctx;

  const email = normalizeEmail(args.email);
  const state = await loadState();

  if (!(email in state.accounts)) {
    return {
      ok: false,
      error: makeError({
        error_code: 'validation_error',
        message:
          `Account "${email}" is not connected to Concierge. ` +
          `Nothing to remove. Call list_accounts to see connected accounts.`,
      }),
    };
  }

  // First call (no confirm) → emit confirmation-required envelope.
  if (args.confirm === undefined) {
    const warning =
      `This will disconnect ${email} from Concierge: revoke Google's access ` +
      `server-side and delete saved credentials from Keychain. Other accounts ` +
      `stay connected. Type the phrase below to proceed.`;
    return {
      ok: false,
      error: buildConfirmationRequiredResponse('remove_account', { email }, warning),
    };
  }

  // Second call — verify phrase.
  const verified = verifyConfirmation('remove_account', { email }, args.confirm);
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

  // Best-effort server-side revoke. Swallow failures and continue to the local
  // delete step — per spec.md, warn on revoke failure but still delete local.
  let revokeOk = true;
  try {
    const result = await runGws(['auth', 'revoke', '--account', email]);
    if (result.exitCode !== 0) {
      revokeOk = false;
      process.stderr.write(
        `concierge: gws auth revoke --account ${email} exited ${String(result.exitCode)}: ${result.stderr.slice(0, 200)}\n`,
      );
    }
  } catch (err: unknown) {
    revokeOk = false;
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`concierge: gws auth revoke --account ${email} threw: ${message}\n`);
  }

  // Local logout — deletes keychain entries for this account.
  let logoutOk = true;
  try {
    const result = await runGws(['auth', 'logout', '--account', email]);
    if (result.exitCode !== 0) {
      logoutOk = false;
      process.stderr.write(
        `concierge: gws auth logout --account ${email} exited ${String(result.exitCode)}: ${result.stderr.slice(0, 200)}\n`,
      );
    }
  } catch (err: unknown) {
    logoutOk = false;
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`concierge: gws auth logout --account ${email} threw: ${message}\n`);
  }

  // Update state: drop the account entry, clear default if it was this one.
  const nextAccounts: Record<string, { read_only: boolean }> = {};
  for (const [k, v] of Object.entries(state.accounts)) {
    if (k !== email) nextAccounts[k] = v;
  }
  const nextDefault = state.default_account === email ? null : state.default_account;

  await writeState({
    state_schema_version: state.state_schema_version,
    default_account: nextDefault,
    accounts: nextAccounts,
  });

  // Invalidate granted-bundles cache so a future list_accounts doesn't see
  // stale scope data for the removed account.
  invalidateGrantedCaches();

  return {
    ok: true,
    data: {
      removed_email: email,
      revoke_ok: revokeOk,
      logout_ok: logoutOk,
      new_default_account: nextDefault,
    },
  };
}

export const removeAccount: ToolDef<RemoveAccountInput, RemoveAccountOutput> = {
  name: 'remove_account',
  description: REMOVE_ACCOUNT_DESCRIPTION,
  service: 'management',
  readonly: false,
  input: RemoveAccountInputSchema,
  output: RemoveAccountOutputSchema,
  invoke,
};
