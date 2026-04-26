// Negative fixture corpus — re-export shim.
//
// Moved to `@concierge/core/log` in setup-hardening-v2 (A3). Preserved here
// so existing test imports (`tests/log/redact-whitelist.test.ts`) keep
// working with no refactor.

export { NEGATIVE_FIXTURES } from '@concierge/core/log';
