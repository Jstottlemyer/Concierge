// Log redaction module — allowlist-based token + PII scrubber.
//
// Originally lived at `packages/google-workspace/src/log/redact.ts`. Moved
// to `@concierge/core/log` in setup-hardening-v2 (D17 / A3) so the upcoming
// `packages/setup` orchestrator can share the exact same scrubber and
// fixture corpus.
//
// Two surfaces:
//   - `redact()` / `redactString()` — credential-shape scrubbing only.
//     Safe for structured MCP outputs because it does NOT touch emails,
//     filesystem usernames, or other PII that the application logic needs
//     to round-trip through (e.g., `gws auth status` JSON parsed by the
//     `list_accounts` tool). This is the pre-D17 behavior; existing call
//     sites in `packages/google-workspace` (gws/runner, mcp/dispatch,
//     mcp/tool-context) keep using this surface.
//   - `redactForLog()` / `redactStringForLog()` — credential scrubbing
//     PLUS PII redaction (emails, GCP project numbers, fs usernames in
//     `/Users/{name}/` paths, JWT identity claims). Use this on anything
//     that hits stdout/stderr, setup logs, or `--diagnose` output where
//     the human reader does not need PII to remain machine-parseable.
//
// Design notes:
// - Patterns target the specific shapes of Google OAuth tokens, base64
//   JWTs, email addresses, GCP project numbers, filesystem usernames in
//   `/Users/` paths, and JWT-payload identity claims.
// - `client_secret`, `access_token`, `refresh_token`, `id_token` key-value
//   shapes require an `=` or `:` separator to avoid mangling benign text
//   like "client_secret_migration" or "access_tokenless design".
// - All redact functions are purely functional: they return structural
//   clones, never mutate the input. Object keys are scrubbed too — a key
//   like `"ya29.LEAK"` would otherwise leak.
// - Spec ref: google-workspace-mcp spec.md AC §20, plan.md Decision #8;
//   setup-hardening-v2 spec D17 / plan A3.
//
// Hard-list design (D17):
// - The "never-emit" hard list is the set of patterns that MUST always
//   redact regardless of caller options (e.g., the future
//   `concierge-setup --diagnose --full` flag).
// - Today the log surface (`*ForLog`) exposes a single function with no
//   opt-out, so the hard list is effectively always-on. When `--full`
//   lands it will skip `PII_PATTERNS` but ALWAYS apply `HARD_LIST_PATTERNS`.

const REDACTED = '[REDACTED]';
const REDACTED_EMAIL = '[email]';
const REDACTED_GCP_PROJECT = '[gcp-project-number]';
const REDACTED_JWT_CLAIM = '[jwt-claim]';

/** Tag separating "always-redact" patterns from "redact unless --full" patterns. */
export type RedactionCategory = 'hard-list' | 'pii';

export interface RedactionPattern {
  readonly name: string;
  readonly pattern: RegExp;
  readonly replacement: string;
  readonly category: RedactionCategory;
}

/**
 * Hard-list patterns — credential-shaped tokens that MUST always be
 * redacted, even when callers opt into less-redacted modes (`--full`).
 * Applied by both `redactString` and `redactStringForLog`.
 *
 * Ordering is not load-bearing — each pattern is applied independently in
 * `redactString`. Regex literals use the `g` flag so every occurrence in a
 * string is scrubbed on a single pass.
 */
export const HARD_LIST_PATTERNS: readonly RedactionPattern[] = [
  // Google OAuth access token — `ya29.` prefix + base64url body.
  {
    name: 'google-access-token',
    pattern: /ya29\.[A-Za-z0-9_-]+/g,
    replacement: REDACTED,
    category: 'hard-list',
  },
  // Google OAuth refresh token — `1//` prefix + base64url body.
  // Require at least one body char so bare "1//" in prose does not match.
  {
    name: 'google-refresh-token',
    pattern: /1\/\/[A-Za-z0-9_-]+/g,
    replacement: REDACTED,
    category: 'hard-list',
  },
  // Google OAuth client secret — `GOCSPX-` prefix + base64url body.
  {
    name: 'google-client-secret',
    pattern: /GOCSPX-[A-Za-z0-9_-]+/g,
    replacement: REDACTED,
    category: 'hard-list',
  },
  // Base64-encoded JWT (triple-dot shape). Anchored on `\beyJ` to avoid
  // matching arbitrary dotted identifiers; requires three base64url segments.
  // The full JWT (header.payload.signature) is hard-listed because the
  // payload (segment 2) carries identity claims (sub/iss/aud/email).
  {
    name: 'jwt-triple-dot',
    pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
    replacement: REDACTED,
    category: 'hard-list',
  },
  // Key=value / key:value shapes for the four credential field names. The
  // `[=:]` separator is mandatory so we do NOT match prose like
  // "access_tokenless design" or "client_secret_migration". An optional
  // leading quote is skipped so `access_token="ya29..."` still matches; the
  // value is greedy up to whitespace or the closing quote.
  {
    name: 'kv-client-secret',
    pattern: /client_secret\s*[=:]\s*"?[^\s"]+/g,
    replacement: REDACTED,
    category: 'hard-list',
  },
  {
    name: 'kv-refresh-token',
    pattern: /refresh_token\s*[=:]\s*"?[^\s"]+/g,
    replacement: REDACTED,
    category: 'hard-list',
  },
  {
    name: 'kv-access-token',
    pattern: /access_token\s*[=:]\s*"?[^\s"]+/g,
    replacement: REDACTED,
    category: 'hard-list',
  },
  {
    name: 'kv-id-token',
    pattern: /id_token\s*[=:]\s*"?[^\s"]+/g,
    replacement: REDACTED,
    category: 'hard-list',
  },
];

/**
 * PII patterns — personally-identifying data that defaults to redacted in
 * the log surface (`*ForLog`), but is intentionally NOT applied by the
 * structured-data surface (`redact` / `redactString`) because application
 * logic round-trips this data (e.g., emails in `gws auth status` parsed
 * by the `list_accounts` tool).
 *
 * A future `redactStringForLog({ full: true })` overload may skip this
 * group while still applying `HARD_LIST_PATTERNS`.
 */
export const PII_PATTERNS: readonly RedactionPattern[] = [
  // Email addresses — RFC 5322-ish: local-part allows letters, digits, and
  // common punctuation; domain requires at least one dot. Conservative
  // enough to avoid mangling URL fragments like "user@host" inside a path.
  {
    name: 'email',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replacement: REDACTED_EMAIL,
    category: 'pii',
  },
  // Filesystem usernames in `/Users/{name}/` paths. Replaces `{name}` with
  // `~` so `/Users/justin/Library/...` → `/Users/~/Library/...`. Preserves
  // path readability for support without leaking the username.
  {
    name: 'fs-username',
    pattern: /(\/Users\/)([A-Za-z0-9._-]+)(\/|$)/g,
    replacement: '$1~$3',
    category: 'pii',
  },
  // GCP project numbers — URL-anchored: `projects/<10-12 digits>`. A
  // looser line-scoped sweep for bare numbers in `gcloud`/`googleapis.com`
  // context is handled by `applyGcpProjectNumberLineSweep` after the
  // pattern-driven pass.
  {
    name: 'gcp-project-number-url',
    pattern: /(projects\/)(\d{10,12})\b/g,
    replacement: `$1${REDACTED_GCP_PROJECT}`,
    category: 'pii',
  },
  // JWT claim values — when a JSON-shaped fragment carries `sub`/`iss`/`aud`
  // (loose JWT body in an error message), redact the value. Hard-listed
  // JWTs are caught by the triple-dot pattern; this catches base64-decoded
  // fragments that may appear in stack traces or logs.
  {
    name: 'jwt-claim-sub',
    pattern: /"sub"\s*:\s*"[^"]+"/g,
    replacement: `"sub":"${REDACTED_JWT_CLAIM}"`,
    category: 'pii',
  },
  {
    name: 'jwt-claim-iss',
    pattern: /"iss"\s*:\s*"[^"]+"/g,
    replacement: `"iss":"${REDACTED_JWT_CLAIM}"`,
    category: 'pii',
  },
  {
    name: 'jwt-claim-aud',
    pattern: /"aud"\s*:\s*"[^"]+"/g,
    replacement: `"aud":"${REDACTED_JWT_CLAIM}"`,
    category: 'pii',
  },
];

/**
 * Back-compat union of credential-shape regexes. Preserves the pre-D17
 * export shape (`readonly RegExp[]`) for any external import.
 */
export const TOKEN_PATTERNS: readonly RegExp[] = HARD_LIST_PATTERNS.map(
  (p) => p.pattern,
);

/**
 * Line-scoped sweep for bare GCP project numbers (10-12 digit runs) that
 * co-occur with a GCP-context keyword on the same line. Run AFTER the
 * URL-anchored pass so already-redacted matches are skipped naturally
 * (the placeholder is non-numeric).
 */
function applyGcpProjectNumberLineSweep(input: string): string {
  return input
    .split('\n')
    .map((line) => {
      const hasGcpContext =
        /gcloud|googleapis\.com|project/i.test(line);
      if (!hasGcpContext) return line;
      return line.replace(/\b\d{10,12}\b/g, REDACTED_GCP_PROJECT);
    })
    .join('\n');
}

/**
 * Redact credential-shape tokens from a string. Pre-D17 behavior:
 * applies ONLY `HARD_LIST_PATTERNS`, leaves emails / paths / project
 * numbers / JWT claim values untouched. Use this on structured payloads
 * the application logic will parse (MCP tool results, gws stdout).
 */
export function redactString(input: string): string {
  let out = input;
  for (const { pattern, replacement } of HARD_LIST_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Redact credential-shape tokens AND PII from a string. Use this on
 * anything destined for stdout/stderr, setup logs, or `--diagnose`
 * output. Applies `HARD_LIST_PATTERNS` + `PII_PATTERNS` + the GCP
 * project-number line sweep.
 */
export function redactStringForLog(input: string): string {
  let out = redactString(input);
  for (const { pattern, replacement } of PII_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  out = applyGcpProjectNumberLineSweep(out);
  return out;
}

function recurse(
  input: unknown,
  scrub: (s: string) => string,
): unknown {
  if (typeof input === 'string') return scrub(input);
  if (Array.isArray(input)) return input.map((item) => recurse(item, scrub));
  if (input !== null && typeof input === 'object') {
    const source = input as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      out[scrub(key)] = recurse(source[key], scrub);
    }
    return out;
  }
  return input;
}

/**
 * Recursively redact credential-shape tokens from any JSON-shaped value.
 * Pre-D17 behavior — does NOT touch PII. Returns a structural clone.
 */
export function redact(input: unknown): unknown {
  return recurse(input, redactString);
}

/**
 * Recursively redact credential-shape tokens AND PII from any
 * JSON-shaped value. Use on payloads destined for logs / `--diagnose`.
 * Returns a structural clone.
 */
export function redactForLog(input: unknown): unknown {
  return recurse(input, redactStringForLog);
}
