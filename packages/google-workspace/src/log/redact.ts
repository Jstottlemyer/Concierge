// Log redaction — re-export shim.
//
// The redactor moved to `@concierge/core/log` in setup-hardening-v2 (A3) so
// `packages/setup` and every future vendor share the exact same scrubber +
// fixture corpus. This file preserves the pre-A3 import path
// (`../log/redact.js`) so existing call sites in `gws/runner.ts`,
// `mcp/tool-context.ts`, and `mcp/dispatch.ts` keep working with no
// refactor. Delete this shim once those call sites are flipped to
// `@concierge/core/log` directly.

export {
  HARD_LIST_PATTERNS,
  PII_PATTERNS,
  TOKEN_PATTERNS,
  redact,
  redactString,
  redactForLog,
  redactStringForLog,
  type RedactionCategory,
  type RedactionPattern,
} from '@concierge/core/log';
