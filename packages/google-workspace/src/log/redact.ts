// Log redaction module — allowlist-based token scrubber.
//
// Runs on every outbound MCP `result` + `error.message` (and any diagnostic
// logged to stderr). Patterns are committed constants — adding a new pattern
// is an intentional, reviewable change. The companion CI fixture tests
// (`tests/log/redact-*.test.ts`) gate both false negatives (real tokens
// escaping) and false positives (legitimate user content mangled).
//
// Design notes:
// - Patterns target the specific shapes of Google OAuth tokens + base64 JWTs.
// - `client_secret`, `access_token`, `refresh_token` key-value shapes require
//   an `=` or `:` separator to avoid mangling benign text like
//   "client_secret_migration" or "access_tokenless design".
// - `redact()` is purely functional: it returns a structural clone, never
//   mutates the input. Object keys are scrubbed too — a key like
//   `"ya29.LEAK"` would otherwise leak.
// - Spec ref: google-workspace-mcp spec.md AC §20, plan.md Decision #8.

const REDACTED = '[REDACTED]';

/**
 * Committed regex patterns for known-credential shapes.
 *
 * Order is not load-bearing — each pattern is applied independently in
 * `redactString`. Regex literals use the `g` flag so every occurrence in a
 * string is scrubbed on a single pass.
 */
export const TOKEN_PATTERNS: readonly RegExp[] = [
  // Google OAuth access token — `ya29.` prefix + base64url body.
  /ya29\.[A-Za-z0-9_-]+/g,

  // Google OAuth refresh token — `1//` prefix + base64url body.
  // Require at least one body char so bare "1//" in prose does not match.
  /1\/\/[A-Za-z0-9_-]+/g,

  // Google OAuth client secret — `GOCSPX-` prefix + base64url body.
  /GOCSPX-[A-Za-z0-9_-]+/g,

  // Base64-encoded JWT (triple-dot shape). Anchored on `\beyJ` to avoid
  // matching arbitrary dotted identifiers; requires three base64url segments.
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,

  // Key=value / key:value shapes. The `[=:]` separator is mandatory so we do
  // NOT match prose like "access_tokenless design" or
  // "client_secret_migration". An optional leading quote is skipped so
  // `access_token="ya29..."` still matches; the value is greedy up to
  // whitespace or the closing quote.
  /client_secret\s*[=:]\s*"?[^\s"]+/g,
  /refresh_token\s*[=:]\s*"?[^\s"]+/g,
  /access_token\s*[=:]\s*"?[^\s"]+/g,
];

/**
 * Redact a single string by applying every token pattern in turn.
 *
 * Each match of a committed pattern is replaced with `[REDACTED]`. Non-matching
 * characters pass through unchanged. Safe to call on arbitrary user content.
 */
export function redactString(input: string): string {
  let out = input;
  for (const pattern of TOKEN_PATTERNS) {
    // Regex has `g` flag; lastIndex is reset automatically by `replace`.
    out = out.replace(pattern, REDACTED);
  }
  return out;
}

/**
 * Recursively redact any JSON-shaped value.
 *
 * - Strings: regex-scrubbed via `redactString`.
 * - Arrays: element-wise recursion, returns a new array.
 * - Plain objects: both keys and values recurse, returns a new object.
 * - Numbers, booleans, null, undefined, bigint, symbol, functions: pass
 *   through unchanged (they cannot embed tokens).
 *
 * Never mutates the input. Accepts `unknown` to satisfy strict-TS callers
 * that log arbitrary payloads.
 */
export function redact(input: unknown): unknown {
  if (typeof input === 'string') {
    return redactString(input);
  }
  if (Array.isArray(input)) {
    return input.map((item) => redact(item));
  }
  if (input !== null && typeof input === 'object') {
    const source = input as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      const redactedKey = redactString(key);
      out[redactedKey] = redact(source[key]);
    }
    return out;
  }
  return input;
}
