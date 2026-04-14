// Shared Concierge error class + canonical `ErrorCode` union.
//
// The union is the single source of truth for every error path that flows
// through `makeError()` (see `src/errors/envelope.ts`). Per plan.md Decision #4
// (error envelope shape) and Decision #5 (human-typed confirmation phrases,
// no token store), the `ConciergeError` class is thrown internally; the
// envelope helper translates it — or a direct `makeError()` call — into the
// outbound wire shape consumed by MCP clients.
//
// Note: plan.md lists `confirmation_expired` alongside `confirmation_required`,
// but Decision #5's "no TTL, no tokens" redesign replaced the expiry code with
// `confirmation_mismatch` (the user typed the wrong phrase). The T5 task scope
// codifies the new union; this file is authoritative.

/** Discriminated code for every Concierge error envelope. */
export type ErrorCode =
  | 'consent_denied'
  | 'read_only_active'
  | 'account_revoked'
  | 'validation_error'
  | 'auth_setup_needed'
  | 'keychain_locked'
  | 'confirmation_required'
  | 'confirmation_mismatch'
  | 'gws_error'
  | 'api_not_enabled'
  | 'auth_in_progress'
  | 'network_error'
  | 'gatekeeper_blocked'
  | 'state_schema_too_new'
  // T2 state-module internal error codes. The user-facing envelope copy for
  // these is handled by the loader (stderr log + `state_schema_too_new` for
  // the out-of-band recovery path). T5 may collapse/rename these as the
  // envelope helper matures; keep them in the union so the state loader
  // compiles under strict-string typing.
  | 'state_file_too_large'
  | 'state_corrupt_json'
  | 'state_corrupt_schema'
  | 'state_migration_gap'
  // T3 tool-registry internal error codes — developer-time errors thrown
  // at registration, not user-facing MCP responses. Kept in the union so
  // the registry compiles against `ConciergeError` under strict typing.
  | 'registry_frozen'
  | 'registry_invalid_name'
  | 'registry_duplicate_name'
  | 'registry_invalid_service';

/** Set form of `ErrorCode` for runtime membership checks. */
export const ERROR_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'consent_denied',
  'read_only_active',
  'account_revoked',
  'validation_error',
  'auth_setup_needed',
  'keychain_locked',
  'confirmation_required',
  'confirmation_mismatch',
  'gws_error',
  'api_not_enabled',
  'auth_in_progress',
  'network_error',
  'gatekeeper_blocked',
  'state_schema_too_new',
  'state_file_too_large',
  'state_corrupt_json',
  'state_corrupt_schema',
  'state_migration_gap',
  'registry_frozen',
  'registry_invalid_name',
  'registry_duplicate_name',
  'registry_invalid_service',
]);

/** Optional structured context attached to an `ConciergeError`. */
export type ErrorDetails = Readonly<Record<string, unknown>>;

/**
 * Thrown internally anywhere in Concierge. Handler layers translate this
 * into the wire envelope via `makeError()` rather than constructing error
 * shapes ad-hoc.
 */
export class ConciergeError extends Error {
  public readonly code: ErrorCode;
  public readonly details: ErrorDetails | undefined;

  public constructor(
    code: ErrorCode,
    message?: string,
    options?: ErrorOptions & { details?: ErrorDetails },
  ) {
    super(message ?? code, options);
    this.name = 'ConciergeError';
    this.code = code;
    this.details = options?.details;

    // Preserve prototype chain when targeting older lib configurations.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Type-guard for `ConciergeError` — useful in catch blocks with `unknown`. */
export function isConciergeError(err: unknown): err is ConciergeError {
  return err instanceof ConciergeError;
}
