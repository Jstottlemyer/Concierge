// Shared helpers for vendor-helper tools (T11).
//
// Every vendor helper follows the same shape: translate a Zod-validated input
// object into a gws argv array (`<service> +<helper> [--flag value]...`), run
// the subprocess, and either parse the stdout JSON into the output schema or
// surface the failure envelope. The boilerplate is identical across 22 tools,
// so this module centralises it.
//
// Design notes:
// - Arg translation is explicit per tool — we don't reflect on the Zod schema
//   because a few flags use non-trivial shapes (CSV joins, boolean presence
//   flags, file repeats). Each tool builds a small array of `FlagSpec` entries
//   and hands it to `buildArgv` + `invokeVendorHelper`.
// - `extra_params` is the universal escape hatch: any `{k: v}` entry becomes
//   `--k v` at the tail of argv. String values only — structured escape is out
//   of scope for v1; complex shapes should get a first-class schema field.
// - `account` is the universal auth param: `--account <email>` is emitted
//   after the main flags, before `extra_params`.
// - `dry_run` surfaces the vendor's `--dry-run` flag uniformly so tests and
//   Read-Only mode can exercise it.
//
// Parsing:
// - Successful runs return stdout that's typically JSON (`--format json` is
//   the vendor default per the help fixtures). If JSON.parse fails we return
//   a `gws_error` envelope describing the malformed output instead of letting
//   the exception escape. Callers that genuinely expect non-JSON output (NDJSON
//   streams from `gmail_watch`, `events_subscribe`) pass `parseOutput: 'raw'`
//   to receive the stdout string under a synthetic `{ stdout, stderr }` shape.

import type { ZodType } from 'zod/v3';

import { makeError, type ErrorEnvelope } from '@concierge/core/errors';
import { runGws } from '../../gws/runner.js';
import { toolErrorFromGwsResult } from '../../gws/errors.js';
import type { ToolResult } from '../types.js';

/**
 * A single flag spec for argv construction. `value` is the already-stringified
 * form — callers apply per-field coercion (CSV join, numeric toString, etc.).
 * `skip === true` short-circuits emission; callers use this to drop undefined
 * optionals without branching.
 */
export interface FlagSpec {
  readonly name: string;
  /** String value; may be explicitly `undefined` when paired with `skip: true`. */
  readonly value?: string | undefined;
  /** If true, emit `--name` with no value (boolean presence flag). */
  readonly boolean?: boolean | undefined;
  /** If true, repeat the flag for each entry in `values`. */
  readonly repeat?: readonly string[] | undefined;
  /** Set to true to skip this flag entirely (undefined optional). */
  readonly skip?: boolean | undefined;
}

/**
 * Build the full gws argv for a vendor helper invocation.
 *
 * Contract:
 *   - `service` and `helper` are literal strings; we prefix the helper with
 *     `+` so callers pass `'send'` and we emit `'gmail', '+send'`.
 *   - `flags` entries are processed in order; `skip === true` entries are
 *     dropped.
 *   - `account`, if provided, becomes `--account <email>`.
 *   - `extraParams` entries are appended last so per-test assertions can
 *     inspect argv deterministically.
 *   - Positional args (a small number of helpers take a positional <file>)
 *     go before the flags so the vendor's clap parser sees them first.
 */
export function buildArgv(params: {
  readonly service: string;
  readonly helper: string;
  readonly positionals?: readonly string[];
  readonly flags: readonly FlagSpec[];
  readonly account?: string;
  readonly extraParams?: Readonly<Record<string, string>>;
}): string[] {
  const { service, helper, positionals, flags, account, extraParams } = params;
  const argv: string[] = [service, `+${helper}`];

  if (positionals !== undefined) {
    for (const p of positionals) argv.push(p);
  }

  for (const spec of flags) {
    if (spec.skip === true) continue;
    if (spec.repeat !== undefined) {
      for (const v of spec.repeat) {
        argv.push(`--${spec.name}`, v);
      }
      continue;
    }
    if (spec.boolean === true) {
      argv.push(`--${spec.name}`);
      continue;
    }
    if (spec.value !== undefined) {
      argv.push(`--${spec.name}`, spec.value);
    }
  }

  if (account !== undefined) {
    argv.push('--account', account);
  }

  if (extraParams !== undefined) {
    for (const [k, v] of Object.entries(extraParams)) {
      argv.push(`--${k}`, v);
    }
  }

  return argv;
}

/**
 * How to interpret the child's stdout on success.
 *   - `'json'`  — default. Parse as JSON, validate via the output schema.
 *   - `'raw'`   — return `{ stdout, stderr }`; the tool's output schema must
 *                 accept that shape. Used by streaming helpers that emit
 *                 NDJSON or long-running binary output.
 */
export type ParseMode = 'json' | 'raw';

export interface InvokeVendorOptions<Output> {
  readonly argv: readonly string[];
  readonly outputSchema: ZodType<Output>;
  readonly parseOutput?: ParseMode;
}

/**
 * Run a vendor helper and translate the result into a `ToolResult`.
 *
 * Happy path:
 *   - exitCode === 0, JSON.parse on stdout succeeds, outputSchema.parse
 *     succeeds → `{ ok: true, data }`.
 *
 * Failure paths (all return `{ ok: false, error }`):
 *   - exitCode !== 0 → `toolErrorFromGwsResult`.
 *   - JSON.parse fails (json mode) → `gws_error` with a diagnostic message.
 *   - outputSchema.parse fails → `gws_error` citing the schema mismatch.
 */
export async function invokeVendorHelper<Output>(
  options: InvokeVendorOptions<Output>,
): Promise<ToolResult<Output>> {
  const { argv, outputSchema, parseOutput } = options;
  const result = await runGws(argv);

  if (result.exitCode !== 0) {
    return { ok: false, error: toolErrorFromGwsResult(result) };
  }

  const mode: ParseMode = parseOutput ?? 'json';

  if (mode === 'raw') {
    const raw: unknown = { stdout: result.stdout, stderr: result.stderr };
    const parsed = outputSchema.safeParse(raw);
    if (!parsed.success) {
      return { ok: false, error: outputSchemaFailure(parsed.error.message, result) };
    }
    return { ok: true, data: parsed.data };
  }

  let value: unknown;
  try {
    value = JSON.parse(result.stdout);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: makeError({
        error_code: 'gws_error',
        message: `gws returned non-JSON stdout: ${reason}`,
        gws_version: result.gwsVersion,
        gws_exit_code: result.exitCode,
        gws_stderr: result.stderr.slice(-500),
      }),
    };
  }

  const parsed = outputSchema.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: outputSchemaFailure(parsed.error.message, result) };
  }
  return { ok: true, data: parsed.data };
}

function outputSchemaFailure(
  reason: string,
  result: { gwsVersion: string; exitCode: number; stderr: string },
): ErrorEnvelope {
  return makeError({
    error_code: 'gws_error',
    message: `gws stdout did not match expected output schema: ${reason}`,
    gws_version: result.gwsVersion,
    gws_exit_code: result.exitCode,
    gws_stderr: result.stderr.slice(-500),
  });
}
