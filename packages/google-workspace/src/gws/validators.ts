// Input validators for everything that flows into a `gws` argv.
//
// Decision #6 (subprocess safety) requires that every string reaching the
// child process be validated — no shell involvement, no flag-injection through
// data fields. These helpers throw `ConciergeError('validation_error')` on
// mismatch; callers let that bubble to the error envelope.
//
// Shape notes:
//   - `service` / `resource` / `method`: match `^[a-z][a-zA-Z0-9_-]{0,48}$`.
//     Lowercase-first per the Google Discovery naming conventions; caps the
//     length so a malicious input cannot blow the argv limit.
//   - `email`: RFC-5322-lite (`localpart@domain.tld`). We are permissive about
//     the localpart — just no whitespace and no angle brackets. Max 254 chars,
//     the RFC-5321 SMTP limit.
//   - `argumentNotFlag`: rejects strings starting with `--`. Purpose: a user-
//     supplied label / name / query must never look like a flag or it could
//     hijack `gws` semantics. Explicit denylist for the three high-impact
//     auth-surface flags (`--credentials`, `--config`, `--auth-override`).
//
// All validators are strict — no coercion, no trimming. Whitespace-sensitive
// on purpose so we reject `" gmail"` rather than silently fixing it.

import { ConciergeError } from '@concierge/core/errors';

/** Regex for `service` / `resource` / `method`. */
const IDENT_RE = /^[a-z][a-zA-Z0-9_-]{0,48}$/;

/** Lightweight email match. Disallows whitespace and `<>` to kill header-style tokens. */
const EMAIL_RE = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/;

/** RFC-5321 cap on SMTP forward-path length. Applied to the whole email. */
const EMAIL_MAX_LEN = 254;

/** Flags the runner refuses to forward under any circumstance. */
export const DENYLISTED_FLAGS: readonly string[] = [
  '--credentials',
  '--config',
  '--auth-override',
];

function fail(message: string): never {
  throw new ConciergeError('validation_error', message);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    fail(`${field} must be a string (got ${typeof value})`);
  }
  return value;
}

/**
 * Validate a gws `service` name (`gmail`, `drive`, `admin-reports`, ...).
 *
 * Matches `^[a-z][a-zA-Z0-9_-]{0,48}$`. Returns the validated string.
 * Throws `ConciergeError('validation_error')` otherwise.
 */
export function validateService(value: unknown): string {
  const s = requireString(value, 'service');
  if (!IDENT_RE.test(s)) {
    fail(`service '${s}' does not match ${IDENT_RE.toString()}`);
  }
  return s;
}

/** Validate a gws `resource` name (same regex as service). */
export function validateResource(value: unknown): string {
  const s = requireString(value, 'resource');
  if (!IDENT_RE.test(s)) {
    fail(`resource '${s}' does not match ${IDENT_RE.toString()}`);
  }
  return s;
}

/** Validate a gws `method` name (same regex as service). */
export function validateMethod(value: unknown): string {
  const s = requireString(value, 'method');
  if (!IDENT_RE.test(s)) {
    fail(`method '${s}' does not match ${IDENT_RE.toString()}`);
  }
  return s;
}

/**
 * Validate an email address. RFC-5322-light: `localpart@domain.tld`, no
 * whitespace, no angle brackets, max 254 chars. Returns the validated string.
 */
export function validateEmail(value: unknown): string {
  const s = requireString(value, 'email');
  if (s.length === 0) {
    fail('email must be non-empty');
  }
  if (s.length > EMAIL_MAX_LEN) {
    fail(`email length ${String(s.length)} exceeds max ${String(EMAIL_MAX_LEN)}`);
  }
  if (!EMAIL_RE.test(s)) {
    fail(`email '${s}' is not a valid RFC-5322-light address`);
  }
  return s;
}

/**
 * Reject any argv fragment that starts with `--`. Data fields (display names,
 * search queries, custom labels) must never masquerade as flags.
 *
 * Also performs explicit denylist checks for the three auth-impacting flags
 * from Decision #6 — `--credentials`, `--config`, `--auth-override` — so the
 * error message is specific and the intent is preserved even if the regex
 * ever gets loosened.
 */
export function validateArgumentNotFlag(value: unknown): string {
  const s = requireString(value, 'argument');

  for (const flag of DENYLISTED_FLAGS) {
    if (s === flag || s.startsWith(`${flag}=`)) {
      fail(`argument '${s}' targets the denylisted flag '${flag}'`);
    }
  }

  if (s.startsWith('--')) {
    fail(`argument '${s}' must not start with '--' (flag-injection guard)`);
  }

  return s;
}

/**
 * Validate an optional `account` field: either undefined or a valid email.
 * Returns `undefined` if not provided, or the validated email string.
 */
export function validateAccountOptional(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return validateEmail(value);
}
