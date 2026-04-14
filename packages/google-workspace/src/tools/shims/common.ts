// Shared infrastructure for Wave 5b T12 shim tools.
//
// Every Concierge-authored shim follows the same shape:
//
//   1. Accept a Zod-validated input object whose top-level fields are the
//      commonly-used Google API params plus `account?` / `extra_params?`.
//   2. Fold the surfaced params into a plain `{camelCaseKey: value}` object,
//      merge `extra_params` on top, and serialize as the JSON blob passed
//      to `gws --params`.
//   3. Prepend the gws subcommand path (e.g. `drive files list`), append
//      `--format json`, and pass `--account <email>` when an account is set.
//   4. Spawn via `runGws`, translate non-zero exits via
//      `toolErrorFromGwsResult`, and parse stdout as JSON.
//   5. Shape the parsed JSON through the shim's Zod OutputSchema and surface
//      it as `{ok: true, data}` (or a `gws_error` envelope on parse failure).
//
// This module factors out everything step 3-5 does so each shim module only
// supplies:
//   - its subcommand path,
//   - a function that folds surfaced params into the API-JSON object,
//   - the Zod output schema.
//
// The helper does NOT force a specific input shape; shims author their own
// Zod `InputSchema` with the fields they want to surface, then call
// `runGwsJson({ subcommand, apiParams, account, extraArgs })`.

import type { ToolContext, ToolResult } from '../types.js';
import { runGws, type RunResult } from '../../gws/runner.js';
import { toolErrorFromGwsResult } from '../../gws/errors.js';
import { makeError, type ErrorEnvelope } from '@concierge/core/errors';
import type { ZodType } from 'zod/v3';

/** Options for a shim invocation routed through `runGwsJson`. */
export interface ShimGwsCallOptions {
  /** Subcommand path, e.g. ['drive', 'files', 'list']. */
  readonly subcommand: readonly string[];
  /** JSON-ready Google API params (pageSize, pageToken, q, ...). */
  readonly apiParams: Readonly<Record<string, unknown>>;
  /** Optional account email — surfaces as `--account <email>`. */
  readonly account?: string;
  /** Optional extra argv appended after `--format json`. Used by shims that
   *  need `--json <body>` (permissions/create, docs/create, meet/spaces/create,
   *  forms/forms/create, sheets/spreadsheets/create). */
  readonly extraArgs?: readonly string[];
}

/**
 * Run a gws shim and parse its stdout as JSON. Always returns a ToolResult
 * — never throws for handled error paths. Spawn-time errors bubble up to the
 * registry's global trap (matches T7 runner contract).
 *
 * Behavior:
 *   - Non-zero exit → `toolErrorFromGwsResult` envelope (gws_error etc.).
 *   - Zero exit but stdout is not valid JSON → `gws_error` envelope with
 *     the first 500 chars of stdout for diagnosis.
 *   - Zero exit + valid JSON but OutputSchema rejects → `gws_error` envelope
 *     (API evolved beyond the shim's shape).
 *   - Everything green → `{ok: true, data: <parsed & schema-validated>}`.
 */
export async function runGwsJson<Output>(
  opts: ShimGwsCallOptions,
  outputSchema: ZodType<Output>,
): Promise<ToolResult<Output>> {
  const argv = buildArgv(opts);
  let result: RunResult;
  try {
    result = await runGws(argv);
  } catch (err: unknown) {
    // Spawn-time ENOENT / EACCES / EPERM — surface as gws_error envelope
    // instead of bubbling (dispatcher can still see ConciergeError, but the
    // tool surface must be total).
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

  // gws with --format json emits one JSON object on stdout (not NDJSON unless
  // --page-all is set — which we never pass).
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

  const shaped = outputSchema.safeParse(parsed);
  if (!shaped.success) {
    return {
      ok: false,
      error: makeError({
        error_code: 'gws_error',
        message: `gws response failed shim output validation: ${shaped.error.message}`,
        gws_version: result.gwsVersion,
        gws_exit_code: result.exitCode,
        gws_stderr: result.stderr.slice(0, 500),
      }),
    };
  }

  return { ok: true, data: shaped.data };
}

/** Build the argv for a shim call. Pure function — exported for tests. */
export function buildArgv(opts: ShimGwsCallOptions): string[] {
  const argv: string[] = [...opts.subcommand];
  if (opts.account !== undefined && opts.account.length > 0) {
    argv.push('--account', opts.account);
  }
  argv.push('--format', 'json');
  // Always emit --params, even when empty-ish, so the gws CLI has a stable
  // shape to parse. An empty object is fine — gws treats missing keys as
  // default values.
  argv.push('--params', JSON.stringify(opts.apiParams));
  if (opts.extraArgs !== undefined && opts.extraArgs.length > 0) {
    argv.push(...opts.extraArgs);
  }
  return argv;
}

/**
 * Merge surfaced fields with `extra_params`. Surfaced fields take precedence
 * over duplicate keys in `extra_params` (so Zod-validated explicit fields
 * can't be overridden by untyped extras).
 *
 * Ordering: surfaced fields appear FIRST in the resulting object (important
 * because we JSON.stringify the result and tests often pin the resulting
 * string — callers expecting a deterministic key order get one).
 */
export function mergeParams(
  surfaced: Readonly<Record<string, unknown>>,
  extraParams?: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(surfaced)) {
    if (v !== undefined) merged[k] = v;
  }
  if (extraParams !== undefined) {
    for (const [k, v] of Object.entries(extraParams)) {
      if (v !== undefined && !(k in merged)) merged[k] = v;
    }
  }
  return merged;
}

/** Utility — returns the domain portion of an email (lowercased). */
export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 0) return '';
  return email.slice(at + 1).toLowerCase();
}

/** Wrap an ErrorEnvelope into a ToolResult failure branch. */
export function fail<T>(error: ErrorEnvelope): ToolResult<T> {
  return { ok: false, error };
}

/** Common invocation context shape — unused at file scope but re-exported
 *  so shim modules can import a single namespace. */
export type { ToolContext, ToolResult };
