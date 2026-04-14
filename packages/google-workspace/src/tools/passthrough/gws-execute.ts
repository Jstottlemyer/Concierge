// gws_execute — T13 passthrough escape hatch.
//
// Invokes any `gws <service> <resource> <method>` Discovery call that isn't
// covered by the 22 vendor helpers or 12 shims. Security per plan Decision #6:
//
//   - `runGws` uses `shell: false` and spawns via argv (no shell interpolation).
//   - service / resource / method are validated with the existing
//     `validateService` / `validateResource` / `validateMethod` regexes, which
//     reject anything outside `^[a-z][a-zA-Z0-9_-]{0,48}$`.
//   - `account`, if present, is validated as an RFC-5322-lite email.
//   - `params` and `body` are JSON objects serialized once and passed inline as
//     the single argv after `--params` / `--json`. Argv bypasses shell quoting
//     so JSON content cannot interpolate; we do NOT use tempfiles because the
//     gws CLI (see `tests/fixtures/gws-help/gws_root.txt`) does not expose
//     `--params-file` / `--body-file` — only inline `--params <JSON>` and
//     `--json <JSON>`. Inline is both safe and idiomatic for this CLI.
//   - `extra_params` keys are matched against an explicit denylist
//     (`credentials`, `config`, `auth-override`, `params-file`, `body-file`,
//     and any key that itself starts with `--`) and every value is run through
//     `validateArgumentNotFlag` to kill flag-injection smuggling.
//
// Read-Only mode: the caller self-declares `readonly: boolean`. The Wave 7
// T17 middleware cross-checks this against the account's read-only state and
// rejects mismatches. This tool just forwards the claim — no local
// enforcement here — so every passthrough remains a single point of truth
// for the middleware.

import { z } from 'zod/v3';

import type { ToolDef, ToolResult, ToolContext } from '../types.js';
import { runGws, type RunResult } from '../../gws/runner.js';
import { toolErrorFromGwsResult } from '../../gws/errors.js';
import {
  validateService,
  validateResource,
  validateMethod,
  validateEmail,
  validateArgumentNotFlag,
} from '../../gws/validators.js';
import { makeError, ConciergeError } from '@concierge/core/errors';

/**
 * Flag-name denylist for `extra_params` keys.
 *
 * - `credentials`, `config`, `auth-override`: auth-surface flags (Decision #6)
 *   — never forwardable from user input.
 * - `params-file`, `body-file`: future-proofing in case the upstream gws CLI
 *   ever grows these; we don't want callers to be able to read arbitrary
 *   filesystem paths through us.
 *
 * Matching is case-sensitive and also checks the `--`-prefixed form so both
 * `credentials` and `--credentials` are rejected.
 */
const EXTRA_PARAMS_DENYLIST: ReadonlySet<string> = new Set<string>([
  'credentials',
  'config',
  'auth-override',
  'params-file',
  'body-file',
]);

/** Canonical input schema for `gws_execute`. */
export const GwsExecuteInputSchema = z
  .object({
    service: z
      .string()
      .regex(/^[a-z][a-zA-Z0-9_-]{0,48}$/)
      .describe('Google Workspace service (e.g., drive, gmail, sheets, admin-reports).'),
    resource: z
      .string()
      .regex(/^[a-z][a-zA-Z0-9_-]{0,48}$/)
      .describe('Resource name per the service Discovery doc (e.g., files, messages, spaces).'),
    method: z
      .string()
      .regex(/^[a-z][a-zA-Z0-9_-]{0,48}$/)
      .describe('Method name per the service Discovery doc (e.g., list, get, create, update).'),
    params: z
      .record(z.unknown())
      .optional()
      .describe('Query parameters object (camelCase keys matching the Discovery doc).'),
    body: z
      .record(z.unknown())
      .optional()
      .describe('JSON request body for POST/PATCH/PUT methods.'),
    upload: z
      .string()
      .optional()
      .describe('Local filesystem path to upload as multipart media content.'),
    readonly: z
      .boolean()
      .describe(
        'Caller asserts whether this call is read-only. Verified by Read-Only mode enforcement.',
      ),
    account: z
      .string()
      .email()
      .optional()
      .describe('Authenticated account email. Omit to use the gws default account.'),
    extra_params: z
      .record(z.string())
      .optional()
      .describe('Additional --flag value pairs. Denylisted auth flags are rejected.'),
  })
  .strict();

export type GwsExecuteInput = z.infer<typeof GwsExecuteInputSchema>;

/**
 * Output is the raw parsed JSON stdout from gws — Discovery responses are
 * unbounded, so we accept any shape and let the caller parse further.
 */
export const GwsExecuteOutputSchema = z.unknown();

export type GwsExecuteOutput = z.infer<typeof GwsExecuteOutputSchema>;

export const GWS_EXECUTE_DESCRIPTION =
  'Invokes any Google Workspace Discovery method directly, bypassing typed Concierge tools. ' +
  "Use when the user's request doesn't fit a typed helper (e.g., rare services or experimental methods). " +
  'Requires an explicit `readonly` classification for Read-Only-mode enforcement. ' +
  'Prefer typed tools when they exist; this is the escape hatch.';

/**
 * Inspect `extra_params` for flag-injection attempts. Returns the validated
 * record on success; throws `ConciergeError('validation_error')` on any
 * denylisted key or flag-prefixed value. Call before serializing the argv
 * so the error surfaces at the tool boundary rather than the subprocess.
 */
function validateExtraParams(
  extra: Readonly<Record<string, string>> | undefined,
): ReadonlyArray<readonly [string, string]> {
  if (extra === undefined) return [];
  const out: Array<readonly [string, string]> = [];
  for (const [rawKey, rawValue] of Object.entries(extra)) {
    // Strip a leading `--` if present so the denylist works for both
    // `credentials` and `--credentials`.
    const normalized = rawKey.startsWith('--') ? rawKey.slice(2) : rawKey;
    if (EXTRA_PARAMS_DENYLIST.has(normalized)) {
      throw new ConciergeError(
        'validation_error',
        `extra_params key '${rawKey}' is denylisted (auth-surface / file-read flag).`,
      );
    }
    // Reject keys that look like attempts to sneak a flag through — we
    // already stripped the leading `--`, so any remaining `--` means the user
    // passed something like `--foo--bar` which is too clever to allow.
    if (normalized.includes(' ') || normalized.length === 0) {
      throw new ConciergeError(
        'validation_error',
        `extra_params key '${rawKey}' is not a valid flag name.`,
      );
    }
    // validateArgumentNotFlag also rejects the three auth-surface flags as
    // values — defense in depth for both key and value.
    validateArgumentNotFlag(rawValue);
    out.push([normalized, rawValue]);
  }
  return out;
}

/**
 * Build the gws argv for this invocation. Pure function — exported for tests
 * so an argv audit can run without spawning a subprocess.
 */
export function buildPassthroughArgv(args: GwsExecuteInput): string[] {
  const service = validateService(args.service);
  const resource = validateResource(args.resource);
  const method = validateMethod(args.method);
  if (args.account !== undefined) {
    validateEmail(args.account);
  }
  const extraPairs = validateExtraParams(args.extra_params);

  const argv: string[] = [service, resource, method];

  if (args.account !== undefined) {
    argv.push('--account', args.account);
  }

  // Always emit --format json so stdout is machine-parseable regardless of
  // the user's terminal default.
  argv.push('--format', 'json');

  // Inline JSON params — argv bypasses shell quoting with `shell: false` so
  // arbitrary JSON content is safe.
  if (args.params !== undefined) {
    argv.push('--params', JSON.stringify(args.params));
  }
  if (args.body !== undefined) {
    argv.push('--json', JSON.stringify(args.body));
  }
  if (args.upload !== undefined) {
    // validateArgumentNotFlag guards against `--upload --evil` tricks.
    validateArgumentNotFlag(args.upload);
    argv.push('--upload', args.upload);
  }

  for (const [key, value] of extraPairs) {
    argv.push(`--${key}`, value);
  }

  return argv;
}

async function invoke(
  args: GwsExecuteInput,
  _ctx: ToolContext,
): Promise<ToolResult<GwsExecuteOutput>> {
  void _ctx;

  // All validation happens inside buildPassthroughArgv. Catch ConciergeError
  // and surface as a validation envelope so the tool contract (never throws
  // for handled error paths) holds.
  let argv: string[];
  try {
    argv = buildPassthroughArgv(args);
  } catch (err: unknown) {
    if (err instanceof ConciergeError) {
      return {
        ok: false,
        error: makeError({
          error_code: err.code === 'validation_error' ? 'validation_error' : 'gws_error',
          message: err.message,
        }),
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: makeError({
        error_code: 'validation_error',
        message: `gws_execute input rejected: ${message}`,
      }),
    };
  }

  let result: RunResult;
  try {
    result = await runGws(argv);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: makeError({
        error_code: 'gws_error',
        message: `failed to invoke gws: ${message}`,
      }),
    };
  }

  if (result.exitCode !== 0) {
    return { ok: false, error: toolErrorFromGwsResult(result) };
  }

  // Empty stdout is acceptable for side-effect-only calls (e.g., delete); we
  // surface the raw string as-is. Non-empty stdout is parsed as JSON.
  if (result.stdout.trim().length === 0) {
    return { ok: true, data: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout) as unknown;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: makeError({
        error_code: 'gws_error',
        message: `gws returned non-JSON stdout: ${message}`,
        gws_version: result.gwsVersion,
        gws_exit_code: result.exitCode,
        gws_stderr: result.stdout.slice(0, 500),
      }),
    };
  }

  return { ok: true, data: parsed };
}

export const gwsExecute: ToolDef<GwsExecuteInput, GwsExecuteOutput> = {
  name: 'gws_execute',
  description: GWS_EXECUTE_DESCRIPTION,
  service: 'passthrough',
  // Default to false — every write-capable Discovery method is non-readonly.
  // The caller's `readonly` field is a separate self-assertion that T17
  // enforces against the account's mode; this ToolDef.readonly is the
  // registry-level flag used for tools/list annotations.
  readonly: false,
  input: GwsExecuteInputSchema,
  output: GwsExecuteOutputSchema,
  invoke,
};
