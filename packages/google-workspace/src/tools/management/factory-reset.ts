// factory_reset — management tool (T14), confirmation-guarded.
//
// Disconnects every account Concierge knows about: best-effort server-side
// revoke + local logout per account, then resets state.json to a fresh v1.
// The extension stays installed. Canonical phrase:
//   `yes delete all my google credentials`

import { z } from 'zod/v3';

import { __resetCachesForTests as invalidateGrantedCaches } from '../../auth/granted-bundles.js';
import { buildConfirmationRequiredResponse } from '../../confirmation/response.js';
import { verifyConfirmation } from '../../confirmation/phrases.js';
import { makeError } from '@concierge/core/errors';
import { runGws } from '../../gws/runner.js';
import { loadState, writeState } from '../../state/loader.js';
import { freshStateV1 } from '../../state/schema.js';
import type { ToolContext, ToolDef, ToolResult } from '../types.js';

export const FactoryResetInputSchema = z
  .object({
    confirm: z.string().optional(),
  })
  .strict();

export type FactoryResetInput = z.infer<typeof FactoryResetInputSchema>;

const AccountResultSchema = z
  .object({
    email: z.string().email(),
    revoke_ok: z.boolean(),
    logout_ok: z.boolean(),
  })
  .strict();

export const FactoryResetOutputSchema = z
  .object({
    removed_accounts: z.array(AccountResultSchema),
    state_reset: z.boolean(),
  })
  .strict();

export type FactoryResetOutput = z.infer<typeof FactoryResetOutputSchema>;

export const FACTORY_RESET_DESCRIPTION =
  'Disconnects every Google account from Concierge, revokes each one on Google\'s side, and ' +
  'erases all saved preferences (state.json). The extension itself stays installed so the user ' +
  'can re-onboard immediately. Irreversible. Use when the user wants a clean slate for Concierge ' +
  'without uninstalling. Requires a human-typed confirmation phrase on the second call; the ' +
  'first call returns the required phrase. For removing a single account, prefer remove_account.';

async function bestEffortGws(args: readonly string[], label: string): Promise<boolean> {
  try {
    const result = await runGws(args);
    if (result.exitCode !== 0) {
      process.stderr.write(
        `concierge: ${label} exited ${String(result.exitCode)}: ${result.stderr.slice(0, 200)}\n`,
      );
      return false;
    }
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`concierge: ${label} threw: ${message}\n`);
    return false;
  }
}

async function invoke(
  args: FactoryResetInput,
  _ctx: ToolContext,
): Promise<ToolResult<FactoryResetOutput>> {
  void _ctx;

  const state = await loadState();
  const emails = Object.keys(state.accounts).sort();

  if (args.confirm === undefined) {
    const count = emails.length;
    const emailList = count > 0 ? emails.join(', ') : '(none)';
    const warning =
      `This will disconnect every Google account from Concierge ` +
      `(${String(count)}: ${emailList}), revoke each on Google's side, and erase ` +
      `all saved preferences. The extension stays installed. Type the phrase ` +
      `below to proceed.`;
    return {
      ok: false,
      error: buildConfirmationRequiredResponse('factory_reset', {}, warning),
    };
  }

  const verified = verifyConfirmation('factory_reset', {}, args.confirm);
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

  const removed: FactoryResetOutput['removed_accounts'] = [];
  for (const email of emails) {
    const revokeOk = await bestEffortGws(
      ['auth', 'revoke', '--account', email],
      `gws auth revoke --account ${email}`,
    );
    const logoutOk = await bestEffortGws(
      ['auth', 'logout', '--account', email],
      `gws auth logout --account ${email}`,
    );
    removed.push({ email, revoke_ok: revokeOk, logout_ok: logoutOk });
  }

  // Reset state to a fresh v1. Using writeState (rather than deleting the
  // file) keeps on-disk invariants consistent: the state dir still exists at
  // 0700 and state.json still exists at 0600, ready for the next sign-in.
  await writeState(freshStateV1());

  invalidateGrantedCaches();

  return {
    ok: true,
    data: {
      removed_accounts: removed,
      state_reset: true,
    },
  };
}

export const factoryReset: ToolDef<FactoryResetInput, FactoryResetOutput> = {
  name: 'factory_reset',
  description: FACTORY_RESET_DESCRIPTION,
  service: 'management',
  readonly: false,
  input: FactoryResetInputSchema,
  output: FactoryResetOutputSchema,
  invoke,
};
