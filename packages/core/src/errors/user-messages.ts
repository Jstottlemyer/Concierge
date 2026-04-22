// T32.5 — User-facing error-copy authoritative strings.
//
// Single source of truth for the user-visible copy attached to each
// `ErrorCode`. UI authors, docs, and tool descriptions all reference this
// map so voice, phrasing, and next-action guidance stay consistent.
//
// Voice rules (from plan Decision #4 + UX pass):
//   - Short, plain-language summary. No jargon, no internal machinery.
//   - First-person when Claude is the speaker ("I didn't get permission …").
//   - Never blame the user. State the situation, then the next step.
//   - `next_action` is a single concrete instruction the user can take now.
//   - `docs_url` is the long-form recovery doc; optional if the summary +
//     next_action are self-contained.
//   - Template slots use `{snake_case}` tokens filled via `getUserMessage`.
//
// `internal_` error codes (state-loader + registry) are developer-facing,
// never hit the wire envelope. They still need an entry so the `Record`
// type stays exhaustive and a future UI that logs them in a diagnostics
// panel has copy to display.
//
// Canonical recovery doc URL — used by `auth_setup_needed`, `state_schema_too_new`,
// and others whose resolution depends on a terminal/manual step outside Claude Desktop.
const ONBOARDING_DOC_URL =
  'https://github.com/Jstottlemyer/Concierge/blob/main/docs/setup/user-onboarding.md';

const TROUBLESHOOTING_DOC_URL =
  'https://github.com/Jstottlemyer/Concierge/blob/main/docs/troubleshooting.md';

import type { ErrorCode } from './errors.js';
import { ERROR_CODES } from './errors.js';

export interface UserFacingMessage {
  /** One- or two-sentence summary of what happened. User-first voice. */
  readonly summary: string;
  /** Single concrete next step. Optional when the summary is self-contained. */
  readonly next_action?: string;
  /** Absolute URL to long-form recovery / explanation. Optional. */
  readonly docs_url?: string;
}

/**
 * Canonical user-facing copy for every `ErrorCode`.
 *
 * Keep this map exhaustive — TypeScript's `Record<ErrorCode, …>` requires
 * every union member to have an entry. Adding a new `ErrorCode` in
 * `src/errors.ts` without a matching entry here is a compile error.
 */
export const USER_FACING_MESSAGES: Record<ErrorCode, UserFacingMessage> = {
  auth_setup_needed: {
    summary:
      "Concierge isn't set up yet. This is a one-time step: you'll create a Google Cloud project, generate an OAuth client, and authenticate the `gws` CLI.",
    next_action:
      'Open Terminal and run `gws auth setup`, or follow the manual path in the onboarding doc.',
    docs_url: ONBOARDING_DOC_URL,
  },
  consent_denied: {
    summary:
      "I didn't get permission for the {bundle_display} scopes. Nothing was changed.",
    next_action: "Ask me to try again — I'll reopen the Google consent page.",
  },
  read_only_active: {
    summary:
      'Read-only mode is on for {account}, so I skipped the write step. Your data is untouched.',
    next_action:
      "To allow writes again, ask me to turn off read-only — you'll be asked to type a confirmation phrase.",
  },
  account_revoked: {
    summary:
      "There's no authenticated Google account, or the stored credential was rejected. That happens on first use, after removing the app from your Google Account, or after changing your password.",
    next_action:
      "Run the command shown in `copyable_command` to (re-)authenticate, then retry.",
  },
  validation_error: {
    summary:
      "One of the inputs to {tool} wasn't what I expected: {field_path}. Nothing was sent.",
    next_action:
      'Clarify the value and ask again. Details above usually point at the exact field.',
  },
  keychain_locked: {
    summary:
      "macOS Keychain is locked, so I can't read the encrypted credentials. This is a security-layer thing, not an Concierge bug.",
    next_action:
      'Unlock Keychain (open Keychain Access.app, or just log in again at the macOS login screen), then retry.',
  },
  confirmation_required: {
    summary:
      'This action is destructive: {operation_description}. To proceed, type the confirmation phrase exactly.',
    next_action:
      'Reply with the confirmation phrase shown above, then I\'ll run the operation.',
  },
  confirmation_mismatch: {
    summary:
      "The phrase you typed didn't match the required confirmation. Nothing was changed.",
    next_action:
      "Ask me again and type the exact phrase — it's case-sensitive and must match verbatim.",
  },
  gws_error: {
    summary:
      "The underlying `gws` CLI returned an error (exit {gws_exit_code}). Claude didn't change anything on Google's side.",
    next_action:
      'Check the `gws_stderr` field for details; retry if it looks transient.',
    docs_url: TROUBLESHOOTING_DOC_URL,
  },
  api_not_enabled: {
    summary:
      "The {api} API isn't enabled in your Google Cloud project yet. Enable it, wait a few seconds, then ask me to retry.",
    next_action:
      'Click the link to enable the API, or run: gcloud services enable {api}.googleapis.com',
  },
  auth_in_progress: {
    summary:
      'A Google sign-in is already in progress in your browser. I\'ll wait for you to finish there.',
    next_action:
      'Finish the consent flow in your browser, then ask me again.',
  },
  network_error: {
    summary:
      "I couldn't reach Google's servers. This is almost always a transient network blip.",
    next_action: 'Retry in a moment. If it keeps failing, check your connection.',
  },
  gatekeeper_blocked: {
    summary:
      "macOS Gatekeeper is blocking the bundled `gws` binary. This is a macOS-security thing — Claude Desktop and Concierge are fine.",
    next_action:
      'Open System Settings → Privacy & Security, find the `gws` entry near the bottom, and click "Open Anyway". Then retry.',
    docs_url: TROUBLESHOOTING_DOC_URL,
  },
  state_schema_too_new: {
    summary:
      "My local state file was written by a newer version of Concierge. To avoid corrupting it, I won't touch it from this version.",
    next_action:
      'Upgrade Concierge to the latest version, or run the recovery command shown in `copyable_command` to reset local state.',
    docs_url: ONBOARDING_DOC_URL,
  },
  // Internal / developer-facing codes — not user-visible in the wire
  // envelope today, but the UI + diagnostics surfaces still need copy.
  state_file_too_large: {
    summary:
      'The Concierge state file is unexpectedly large (> 64 KiB). I stopped loading it as a safety measure.',
    next_action:
      'Contact the developer — this usually indicates local corruption. A reset via `factory_reset` or manual removal of `~/Library/Application Support/Claude/extensions/concierge/state.json` will recover.',
    docs_url: TROUBLESHOOTING_DOC_URL,
  },
  state_corrupt_json: {
    summary:
      "The Concierge state file isn't valid JSON. I backed it up and stopped to avoid making things worse.",
    next_action:
      'Remove or restore the state file, then restart Claude Desktop. The backup is at `~/Library/Application Support/Claude/extensions/concierge/state.json.bak.<timestamp>`.',
    docs_url: TROUBLESHOOTING_DOC_URL,
  },
  state_corrupt_schema: {
    summary:
      "The Concierge state file's JSON is well-formed but doesn't match the expected schema.",
    next_action:
      'Remove or restore the state file, then restart Claude Desktop. The backup is at `~/Library/Application Support/Claude/extensions/concierge/state.json.bak.<timestamp>`.',
    docs_url: TROUBLESHOOTING_DOC_URL,
  },
  state_migration_gap: {
    summary:
      'The Concierge state file is from a version I have no migration path for. This is usually an internal bug.',
    next_action:
      'Contact the developer or reset local state via the recovery command.',
    docs_url: TROUBLESHOOTING_DOC_URL,
  },
  registry_frozen: {
    summary:
      'Internal: the tool registry is frozen and cannot accept new registrations.',
    next_action: 'This is a developer-time error; restart the server.',
  },
  registry_invalid_name: {
    summary:
      'Internal: a tool was registered with an invalid name ({tool_name}).',
    next_action: 'This is a developer-time error; fix the registration call.',
  },
  registry_duplicate_name: {
    summary:
      'Internal: a tool name was registered twice ({tool_name}).',
    next_action: 'This is a developer-time error; remove the duplicate registration.',
  },
  registry_invalid_service: {
    summary:
      'Internal: a tool declared an unknown service slug ({service}).',
    next_action: 'This is a developer-time error; correct the service slug.',
  },
};

/**
 * Resolve the user-facing summary for an `ErrorCode`, interpolating any
 * `{token}` placeholders from `context`. Unknown tokens are left as-is so
 * callers can see which slot they forgot to fill.
 */
export function getUserMessage(
  code: ErrorCode,
  context?: Readonly<Record<string, string>>,
): string {
  if (!ERROR_CODES.has(code)) {
    throw new Error(`getUserMessage: unknown error_code '${String(code)}'`);
  }
  const entry = USER_FACING_MESSAGES[code];
  return interpolate(entry.summary, context);
}

/**
 * Resolve the `next_action` for an `ErrorCode` with the same interpolation
 * rules as `getUserMessage`. Returns `undefined` when the code has no
 * next_action defined.
 */
export function getNextAction(
  code: ErrorCode,
  context?: Readonly<Record<string, string>>,
): string | undefined {
  if (!ERROR_CODES.has(code)) {
    throw new Error(`getNextAction: unknown error_code '${String(code)}'`);
  }
  const entry = USER_FACING_MESSAGES[code];
  return entry.next_action === undefined ? undefined : interpolate(entry.next_action, context);
}

const TOKEN_RE = /\{([a-z_][a-z0-9_]*)\}/gi;

function interpolate(template: string, context?: Readonly<Record<string, string>>): string {
  if (context === undefined) {
    return template;
  }
  return template.replace(TOKEN_RE, (match, key: string) => {
    const value = context[key];
    return value === undefined ? match : value;
  });
}
