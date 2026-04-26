// `@concierge/core/log` barrel — log scrubbing primitives shared across
// vendor packages and the setup orchestrator.

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
} from './redact.js';

export { NEGATIVE_FIXTURES } from './redact-whitelist.js';
