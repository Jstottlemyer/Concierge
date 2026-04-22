// Translate a failed `runGws` result into the canonical `ErrorEnvelope`.
//
// The runner (runner.ts) returns non-zero exits as plain results — no
// exceptions — so this policy layer decides which `ErrorCode` a given exit
// code maps to. Mapping follows Decision #6 and the spikes.md findings on
// gws's exit-code convention:
//
//     0  success                        (assert — never call this here)
//     1  generic runtime failure  →     gws_error
//     2  authentication / token error → account_revoked
//     3  validation / argument error  → validation_error
//     4  network failure              → network_error
//     5  internal gws error           → gws_error
//    -1  runner-side timeout / abort  → network_error + retry_after_ms:1000
//
// Note on exit 2: gws emits this for BOTH "no credentials stored yet" and
// "credentials present but rejected by Google." We can't distinguish without
// an extra `gws auth status` probe (deferred to docs/specs/auth-probe/), so
// the user-facing message and copyable command cover both cases. This is why
// `list_accounts` can return [] while a tool call returns `account_revoked` —
// they're consistent reads of the same exit-2 state, not contradictions.
//
// Before exit-code translation, stderr is scanned for Google Cloud API
// enablement signatures. When detected, we emit `api_not_enabled` with a
// direct one-click enable URL for the specific API, bypassing the generic
// exit-code mapping. This is the single most common first-use friction for
// new Concierge users (each Google API must be activated per-project).
//
// Every translated envelope carries diagnostic metadata: `gws_version`,
// `gws_exit_code`, and the last 500 chars of `gws_stderr` (already redacted
// by the runner). The caller is responsible for attaching any tool-specific
// `next_call` or `copyable_command` hints on top of what this produces.

import { makeError, type ErrorEnvelope, type ErrorCode } from '@concierge/core/errors';
import { TIMEOUT_EXIT_CODE } from './runner.js';
import type { RunResult } from './runner.js';

/** Maximum stderr tail length included in the envelope. */
export const STDERR_TAIL_BYTES = 500;

/** Retry hint for timeout-derived envelopes (ms). */
export const TIMEOUT_RETRY_AFTER_MS = 1000;

/**
 * Default `gws auth login` command suggested when exit 2 fires. Covers the
 * five highest-frequency Workspace services (productivity bundle minus the
 * less-common forms/tasks). The user can edit before running — this is just
 * a paste-ready starting point. Kept short to avoid encouraging users to
 * grant scopes they don't need.
 */
export const REAUTH_COPYABLE_COMMAND =
  'gws auth login --services drive,gmail,docs,sheets,calendar';

/**
 * Map of gws service slug → Google Cloud API service name (the FQDN used in
 * the Cloud Console API Library URL and `gcloud services enable`).
 *
 * Keep this list in sync with the bundle registry and docs/setup/user-onboarding.md.
 */
export const SERVICE_TO_API: Readonly<Record<string, string>> = Object.freeze({
  gmail: 'gmail.googleapis.com',
  drive: 'drive.googleapis.com',
  docs: 'docs.googleapis.com',
  sheets: 'sheets.googleapis.com',
  calendar: 'calendar-json.googleapis.com',
  forms: 'forms.googleapis.com',
  tasks: 'tasks.googleapis.com',
  slides: 'slides.googleapis.com',
  chat: 'chat.googleapis.com',
  meet: 'meet.googleapis.com',
  people: 'people.googleapis.com',
  'admin-reports': 'admin.googleapis.com',
  classroom: 'classroom.googleapis.com',
  script: 'script.googleapis.com',
  events: 'workspaceevents.googleapis.com',
  modelarmor: 'modelarmor.googleapis.com',
});

/**
 * Reverse lookup: full `<api>.googleapis.com` hostname → friendly gws service
 * slug. Used when we can extract the API hostname from Google's error text
 * but don't know which gws service the call originated from.
 */
const API_TO_SERVICE: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    Object.entries(SERVICE_TO_API).map(([service, api]) => [api, service]),
  ),
);

/** Shape of the parsed api_not_enabled signal. */
interface ApiNotEnabledMatch {
  /** gws service slug (e.g., "gmail", "drive"). Falls back to host prefix. */
  readonly service: string;
  /** Full API hostname (e.g., "gmail.googleapis.com"). */
  readonly apiHost: string;
  /** Google Cloud project number or project id, if parseable from stderr. */
  readonly projectId?: string;
}

/**
 * Scan gws stderr for Google Cloud "API not enabled" signatures. Returns the
 * match details if any signature is found, otherwise undefined. Signatures
 * covered:
 *   1. `"<API> has not been used in project <NUMBER> before or it is disabled."`
 *   2. `"API <api>.googleapis.com has not been used"` (generic)
 *   3. `"consumer <project> does not have access to the <api>"` + URL
 *   4. `"reason": "SERVICE_DISABLED"` in a JSON error body
 */
export function detectApiNotEnabled(stderr: string): ApiNotEnabledMatch | undefined {
  if (typeof stderr !== 'string' || stderr.length === 0) {
    return undefined;
  }

  // Quick gate: if none of the sentinel substrings appear, bail.
  const hasSignature =
    stderr.includes('has not been used in project') ||
    stderr.includes('API has not been used') ||
    stderr.includes('SERVICE_DISABLED') ||
    stderr.includes('consumer does not have access to');
  if (!hasSignature) {
    return undefined;
  }

  // Attempt to pull the API hostname from the stderr. Google formats vary,
  // but `<name>.googleapis.com` is universal across them.
  //
  // Caveats:
  //   - `type.googleapis.com` is a protobuf type-URL sentinel (e.g.
  //     `type.googleapis.com/google.rpc.ErrorInfo`), NOT a real API host.
  //   - Prefer the known Workspace-service API hosts (SERVICE_TO_API reverse
  //     map) when multiple `*.googleapis.com` strings appear in stderr; fall
  //     back to the first non-sentinel match otherwise.
  const hostRe = /\b([a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)?)\.googleapis\.com\b/gi;
  let apiHost: string | undefined;
  const allMatches: string[] = [];
  for (const match of stderr.matchAll(hostRe)) {
    const host = match[0].toLowerCase();
    if (host === 'type.googleapis.com') {
      continue;
    }
    allMatches.push(host);
  }
  // Prefer a host that is a known Workspace API; otherwise take the first.
  apiHost = allMatches.find((h) => API_TO_SERVICE[h] !== undefined) ?? allMatches[0];

  // Pull project number (preferred) or project id. Google's canonical phrasing:
  //   "... has not been used in project 123456789012 before ..."
  //   "... consumer 'projects/123456789012' does not ..."
  const projectNumMatch = /\bproject\s+(\d{6,})\b/i.exec(stderr);
  const projectQuotedMatch = /projects\/([a-z0-9][a-z0-9-]{4,})/i.exec(stderr);
  const projectId =
    projectNumMatch !== null
      ? projectNumMatch[1]
      : projectQuotedMatch !== null
        ? projectQuotedMatch[1]
        : undefined;

  // Resolve service slug. Prefer the SERVICE_TO_API reverse map; otherwise
  // fall back to the host's first label (best-effort for APIs outside the
  // Workspace set — e.g., a future "generativelanguage.googleapis.com").
  let service: string | undefined;
  let resolvedApiHost: string | undefined = apiHost;
  if (apiHost !== undefined && API_TO_SERVICE[apiHost] !== undefined) {
    service = API_TO_SERVICE[apiHost];
  } else if (apiHost !== undefined) {
    service = apiHost.split('.')[0];
  } else {
    // Last resort: scan stderr for any known service slug keyword appearing
    // near an "API" mention. This handles stderr that only mentions the API
    // by friendly name (rare but survives if Google ever changes wording).
    for (const [slug, host] of Object.entries(SERVICE_TO_API)) {
      const slugRe = new RegExp(`\\b${slug}\\b\\s+API`, 'i');
      if (slugRe.test(stderr)) {
        service = slug;
        resolvedApiHost = host;
        break;
      }
    }
  }

  if (service === undefined || resolvedApiHost === undefined) {
    // Signature matched but we couldn't identify which API. Still useful to
    // report — the caller gets the generic API Library URL.
    return { service: 'workspace', apiHost: 'library', ...(projectId !== undefined ? { projectId } : {}) };
  }

  return {
    service,
    apiHost: resolvedApiHost,
    ...(projectId !== undefined ? { projectId } : {}),
  };
}

/** Build the Cloud Console one-click enable URL for a given API + optional project. */
function buildDocsUrl(match: ApiNotEnabledMatch): string {
  const base =
    match.apiHost === 'library'
      ? 'https://console.cloud.google.com/apis/library'
      : `https://console.cloud.google.com/apis/library/${match.apiHost}`;
  return match.projectId !== undefined ? `${base}?project=${match.projectId}` : base;
}

/** Build the `gcloud services enable` copyable command for this API. */
function buildCopyableCommand(match: ApiNotEnabledMatch): string | undefined {
  if (match.apiHost === 'library') {
    // Don't fabricate a gcloud command we can't validate.
    return undefined;
  }
  return `gcloud services enable ${match.apiHost}`;
}

/**
 * Translate a failed `RunResult` into an `ErrorEnvelope`.
 *
 * Contract: `result.exitCode !== 0`. Passing a success result is a programmer
 * error — we throw rather than silently fabricating an error envelope.
 *
 * Before exit-code translation, stderr is sniffed for Google Cloud API
 * enablement errors (the most common first-use failure for new users). When
 * detected, an `api_not_enabled` envelope is returned directly with a
 * one-click enable URL.
 */
export function toolErrorFromGwsResult(result: RunResult): ErrorEnvelope {
  if (result.exitCode === 0) {
    throw new Error(
      'toolErrorFromGwsResult called with a successful RunResult (exitCode === 0)',
    );
  }

  const stderrTail = result.stderr.slice(-STDERR_TAIL_BYTES);

  // Pre-translation sniff: Google Cloud API enablement error.
  const apiMatch = detectApiNotEnabled(result.stderr);
  if (apiMatch !== undefined) {
    const friendlyService = apiMatch.service === 'workspace' ? 'Google Workspace' : apiMatch.service;
    const message =
      `The ${friendlyService} API isn't enabled for your Google Cloud project. ` +
      `Enable it in one click, then retry.`;
    const docsUrl = buildDocsUrl(apiMatch);
    const copyable = buildCopyableCommand(apiMatch);

    return makeError({
      error_code: 'api_not_enabled',
      message,
      gws_version: result.gwsVersion,
      gws_exit_code: result.exitCode,
      gws_stderr: stderrTail,
      docs_url: docsUrl,
      ...(copyable !== undefined ? { copyable_command: copyable } : {}),
    });
  }

  const { code, message, retryAfterMs, copyableCommand } = codeFor(result.exitCode);

  return makeError({
    error_code: code,
    message,
    gws_version: result.gwsVersion,
    gws_exit_code: result.exitCode,
    gws_stderr: stderrTail,
    ...(retryAfterMs !== undefined ? { retry_after_ms: retryAfterMs } : {}),
    ...(copyableCommand !== undefined ? { copyable_command: copyableCommand } : {}),
  });
}

interface Mapping {
  readonly code: ErrorCode;
  readonly message: string;
  readonly retryAfterMs?: number;
  readonly copyableCommand?: string;
}

/**
 * Exit-code → (ErrorCode, human message, optional retry hint) table.
 * Kept small and explicit so the matrix is reviewable at a glance. Unknown
 * exit codes fall back to `gws_error` so the envelope is always populated.
 */
function codeFor(exitCode: number): Mapping {
  if (exitCode === TIMEOUT_EXIT_CODE) {
    return {
      code: 'network_error',
      message: 'gws subprocess timed out or was aborted before completing.',
      retryAfterMs: TIMEOUT_RETRY_AFTER_MS,
    };
  }
  switch (exitCode) {
    case 1:
      return { code: 'gws_error', message: 'gws exited with a runtime error.' };
    case 2:
      return {
        code: 'account_revoked',
        message:
          'No authenticated Google account, or the stored token was rejected. ' +
          'Run the command in `copyable_command` to (re-)authenticate.',
        copyableCommand: REAUTH_COPYABLE_COMMAND,
      };
    case 3:
      return {
        code: 'validation_error',
        message: 'gws rejected the request arguments as invalid.',
      };
    case 4:
      return { code: 'network_error', message: 'gws could not reach the upstream service.' };
    case 5:
      return { code: 'gws_error', message: 'gws reported an internal error.' };
    default:
      return {
        code: 'gws_error',
        message: `gws exited with unrecognized code ${String(exitCode)}.`,
      };
  }
}
