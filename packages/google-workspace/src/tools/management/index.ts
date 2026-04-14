// Management tool barrel + registration entry point.
//
// Concierge-owned tools that manage connected Google accounts and per-account
// preferences, plus cross-cutting diagnostic tools like concierge_info. Unlike
// vendor helpers and shims, these do not passthrough to `gws` for their
// primary work — they read/write state.json directly (and call `gws` only for
// best-effort server-side revocation or version probes).

import { registerTool } from '../registry.js';
import type { AnyToolDef, ToolDef } from '../types.js';

import { conciergeHelp } from './concierge-help.js';
import { conciergeInfo } from './concierge-info.js';
import { factoryReset } from './factory-reset.js';
import { listAccounts } from './list-accounts.js';
import { removeAccount } from './remove-account.js';
import { setDefaultAccount } from './set-default-account.js';
import { setReadOnly } from './set-read-only.js';

/**
 * Ordered list of every management-tool definition. Order is stable and used
 * both as registration order and as the expected order in registration tests.
 * Alphabetical by tool name.
 */
export const MANAGEMENT_TOOLS: readonly AnyToolDef[] = [
  conciergeHelp as unknown as AnyToolDef,
  conciergeInfo as unknown as AnyToolDef,
  factoryReset as unknown as AnyToolDef,
  listAccounts as unknown as AnyToolDef,
  removeAccount as unknown as AnyToolDef,
  setDefaultAccount as unknown as AnyToolDef,
  setReadOnly as unknown as AnyToolDef,
];

/**
 * Register every management tool with the shared registry. Idempotent only up
 * to the underlying `registerTool` contract — calling twice raises
 * `registry_duplicate_name`. Call once at bootstrap.
 */
export function registerManagementTools(): void {
  for (const tool of MANAGEMENT_TOOLS) {
    registerTool(tool as unknown as ToolDef<unknown, unknown>);
  }
}

export {
  conciergeHelp,
  conciergeInfo,
  factoryReset,
  listAccounts,
  removeAccount,
  setDefaultAccount,
  setReadOnly,
};
