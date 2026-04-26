// Negative fixture corpus for the credential-shape redactor (`redactString`).
//
// These are strings that LOOK token-shaped to a careless regex but are
// actually legitimate user content. `redactString` MUST pass them through
// unchanged. If a new pattern is added to `HARD_LIST_PATTERNS` that would
// mangle any of these, either tighten the pattern or justify the trade-off
// in review.
//
// Note: this corpus is for the credential-only surface. PII patterns
// (emails, fs usernames, etc.) DO redact several of the strings below
// (e.g., the email in `eynon.alice@example.com` would be replaced by the
// `email` pattern in `redactStringForLog`). PII-surface negative fixtures
// live alongside their tests; this file stays focused on the
// false-positive risk in credential-shape patterns.
//
// Migrated from `packages/google-workspace/src/log/redact-whitelist.ts`
// in setup-hardening-v2 (A3).

export const NEGATIVE_FIXTURES: readonly string[] = [
  // A date with four-digit year — must not look like a JWT header.
  'The deadline is 2024-03-15',

  // A URL that mentions `client_secret` as a documentation slug — the
  // key=value scrubber requires `=` or `:` so this passes through.
  'See https://docs.example.com/client_secret_migration',

  // Bare `1//` in prose (e.g., a meeting shorthand) — the refresh-token
  // pattern requires at least one body char after the slashes.
  'Meeting at 1//',

  // Compound word containing `access_token` as a prefix — the key=value
  // scrubber requires an `=` or `:` separator, so this passes through.
  'access_tokenless design',

  // A sentence that mentions `refresh_token` as a noun without a value.
  'The refresh_token concept is documented upstream.',

  // A sentence that contains `client_secret` without assignment.
  'Rotate your client_secret regularly.',

  // A dotted identifier that starts with `ey` but not `eyJ` — must not
  // trip the JWT word-boundary anchor.
  'Contact eynon.alice@example.com for details.',

  // A file path that happens to contain `ya29` as a substring but not as
  // the token-prefix shape (requires trailing `.`).
  'Logs archived to /var/log/ya29-report.txt',
];
