// list_accounts — management tool (T14).
//
// Returns a snapshot of every Google account Concierge knows about, along with
// each account's granted bundles (derived by querying `gws` for its per-account
// scopes) and Read-Only flag. Also surfaces `default_account`.
//
// This is a readonly tool: it reads state.json and queries gws but never writes.
// The granted-bundle lookup is per-account via `getGrantedBundlesForAccount`,
// which itself caches subprocess calls for 30s (so repeated list_accounts calls
// in the same session don't re-spawn gws for every account).

import { z } from 'zod/v3';

import type { BundleId } from '../../bundles/types.js';
import {
  getGrantedBundlesForAccount,
  listAuthenticatedAccounts,
} from '../../auth/granted-bundles.js';
import { runGws } from '../../gws/runner.js';
import { loadState } from '../../state/loader.js';
import type { ToolContext, ToolDef, ToolResult } from '../types.js';

/** Bundle id literal list for Zod — must match `BundleId` in bundles/types. */
const BUNDLE_IDS = [
  'productivity',
  'collaboration',
  'admin',
  'education',
  'creator',
  'automation',
] as const satisfies readonly BundleId[];

export const ListAccountsInputSchema = z.object({}).strict();

export type ListAccountsInput = z.infer<typeof ListAccountsInputSchema>;

const AccountEntrySchema = z
  .object({
    email: z.string().email(),
    is_default: z.boolean(),
    granted_bundles: z.array(z.enum(BUNDLE_IDS)),
    read_only: z.boolean(),
  })
  .strict();

export const ListAccountsOutputSchema = z
  .object({
    accounts: z.array(AccountEntrySchema),
    default_account: z.string().email().nullable(),
  })
  .strict();

export type ListAccountsOutput = z.infer<typeof ListAccountsOutputSchema>;

export const LIST_ACCOUNTS_DESCRIPTION =
  'Lists every Google account connected to Concierge with each account\'s granted scope bundles ' +
  'and Read-Only flag, plus which account is the current default. Use when the user asks which ' +
  'accounts are signed in, what scopes were granted, or to audit Read-Only state. For adding a ' +
  'new account, prefer running a tool without `account` (Concierge triggers first-run sign-in ' +
  'automatically); for removing an account, prefer remove_account.';

async function invoke(
  _args: ListAccountsInput,
  _ctx: ToolContext,
): Promise<ToolResult<ListAccountsOutput>> {
  void _args;
  void _ctx;

  const state = await loadState();

  // Source of truth for "which accounts exist" is gws (`auth status`) — not
  // state.json. state.json only stores Concierge-owned metadata (default flag,
  // read_only). If the user authenticated via terminal `gws auth login`,
  // state.json has no entry yet — we surface that account here even so.
  //
  // Merge strategy: take the union of state.accounts and gws-reported accounts.
  // For each, enrich with state metadata (defaulting read_only=false for
  // accounts gws knows about but state doesn't).
  const authedEmails = await listAuthenticatedAccounts({ runGws });
  const stateEmails = Object.keys(state.accounts);
  const allEmails = new Set<string>([...authedEmails, ...stateEmails]);
  const emails = [...allEmails].sort();

  // If there's no default_account persisted but exactly one account is
  // authenticated, surface that as the effective default (derived, not written).
  const effectiveDefault =
    state.default_account ?? (emails.length === 1 ? (emails[0] ?? null) : null);

  const accounts: ListAccountsOutput['accounts'] = [];
  for (const email of emails) {
    const stateEntry = state.accounts[email];
    const grantedSet = await getGrantedBundlesForAccount(email, { runGws });
    accounts.push({
      email,
      is_default: effectiveDefault === email,
      granted_bundles: [...grantedSet].sort(),
      read_only: stateEntry?.read_only ?? false,
    });
  }

  return {
    ok: true,
    data: {
      accounts,
      default_account: effectiveDefault,
    },
  };
}

export const listAccounts: ToolDef<ListAccountsInput, ListAccountsOutput> = {
  name: 'list_accounts',
  description: LIST_ACCOUNTS_DESCRIPTION,
  service: 'management',
  readonly: true,
  input: ListAccountsInputSchema,
  output: ListAccountsOutputSchema,
  invoke,
};
