// Concierge error envelope — the single wire shape returned to MCP clients
// for every failure path. Per plan.md Decision #4, there is exactly one
// constructor: `makeError()`. No hand-rolled envelopes anywhere else.
//
// In dev mode (NODE_ENV !== 'production') the outbound envelope is validated
// with Zod so schema drift fails loudly during development and CI. Production
// skips the validation cost; the builder itself is total, so a well-typed call
// site cannot produce an invalid envelope.

import { z } from 'zod';

import type { ErrorCode } from './errors.js';
import { ERROR_CODES } from './errors.js';

/** Follow-up tool call surfaced to the caller (e.g., for confirmation flow). */
export interface NextCall {
  readonly tool: string;
  readonly arguments: Readonly<Record<string, unknown>>;
}

/**
 * Wire-shape error envelope per plan.md Decision #4.
 *
 * `ok: false` is the constant discriminator so the same channel can later
 * carry `{ ok: true, ... }` success envelopes without ambiguity.
 */
export interface ErrorEnvelope {
  readonly ok: false;
  readonly error_code: ErrorCode;
  readonly message: string;
  readonly gws_version?: string;
  readonly gws_stderr?: string;
  readonly gws_exit_code?: number;
  readonly confirmation_phrase?: string;
  readonly retry_after_ms?: number;
  readonly next_call?: NextCall;
  readonly copyable_command?: string;
  readonly docs_url?: string;
}

/** Options accepted by `makeError()`. `error_code` + `message` are required. */
export interface MakeErrorOptions {
  readonly error_code: ErrorCode;
  readonly message: string;
  readonly gws_version?: string;
  readonly gws_stderr?: string;
  readonly gws_exit_code?: number;
  readonly confirmation_phrase?: string;
  readonly retry_after_ms?: number;
  readonly next_call?: NextCall;
  readonly copyable_command?: string;
  readonly docs_url?: string;
}

const ErrorCodeSchema = z.custom<ErrorCode>(
  (value): value is ErrorCode => typeof value === 'string' && ERROR_CODES.has(value as ErrorCode),
  { message: 'error_code must be one of the canonical ErrorCode values' },
);

const NextCallSchema = z
  .object({
    tool: z.string().min(1),
    arguments: z.record(z.string(), z.unknown()),
  })
  .strict();

/** Zod schema used for dev-mode outbound validation. */
export const ErrorEnvelopeSchema = z
  .object({
    ok: z.literal(false),
    error_code: ErrorCodeSchema,
    message: z.string().min(1),
    gws_version: z.string().optional(),
    gws_stderr: z.string().optional(),
    gws_exit_code: z.number().int().optional(),
    confirmation_phrase: z.string().min(1).optional(),
    retry_after_ms: z.number().int().nonnegative().optional(),
    next_call: NextCallSchema.optional(),
    copyable_command: z.string().optional(),
    docs_url: z.string().url().optional(),
  })
  .strict();

function isDevMode(): boolean {
  // Any non-production environment triggers schema validation. Undefined
  // counts as dev — tests and local runs typically don't set NODE_ENV.
  const env = typeof process !== 'undefined' ? process.env['NODE_ENV'] : undefined;
  return env !== 'production';
}

/**
 * Build an `ErrorEnvelope` from typed options.
 *
 * Required: `error_code`, `message` (non-empty after trim). Everything else
 * is optional and only included in the envelope when defined — satisfies
 * `exactOptionalPropertyTypes`.
 *
 * Dev-mode validates the result with Zod and throws on schema drift so
 * mistakes surface during testing rather than at runtime for users.
 */
export function makeError(opts: MakeErrorOptions): ErrorEnvelope {
  if (typeof opts.message !== 'string' || opts.message.trim().length === 0) {
    throw new Error('makeError: `message` must be a non-empty string');
  }
  if (!ERROR_CODES.has(opts.error_code)) {
    throw new Error(`makeError: unknown error_code '${String(opts.error_code)}'`);
  }

  // Assemble with conditional spreads so `exactOptionalPropertyTypes` holds.
  const envelope: ErrorEnvelope = {
    ok: false,
    error_code: opts.error_code,
    message: opts.message,
    ...(opts.gws_version !== undefined ? { gws_version: opts.gws_version } : {}),
    ...(opts.gws_stderr !== undefined ? { gws_stderr: opts.gws_stderr } : {}),
    ...(opts.gws_exit_code !== undefined ? { gws_exit_code: opts.gws_exit_code } : {}),
    ...(opts.confirmation_phrase !== undefined
      ? { confirmation_phrase: opts.confirmation_phrase }
      : {}),
    ...(opts.retry_after_ms !== undefined ? { retry_after_ms: opts.retry_after_ms } : {}),
    ...(opts.next_call !== undefined ? { next_call: opts.next_call } : {}),
    ...(opts.copyable_command !== undefined ? { copyable_command: opts.copyable_command } : {}),
    ...(opts.docs_url !== undefined ? { docs_url: opts.docs_url } : {}),
  };

  if (isDevMode()) {
    const parsed = ErrorEnvelopeSchema.safeParse(envelope);
    if (!parsed.success) {
      throw new Error(`makeError: envelope failed dev-mode validation: ${parsed.error.message}`);
    }
  }

  return envelope;
}
