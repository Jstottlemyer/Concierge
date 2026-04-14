// Canonical confirmation phrases for destructive operations.
//
// Per plan.md Decision #5 (and spec.md §"Destructive operations (human-typed
// confirmation)"), destructive ops require the user to type an exact phrase
// as the `confirm` parameter. No server-minted tokens, no TTL, no in-memory
// state — the phrase is a pure function of `(operation, target)`.
//
// Why: the adversarial-tool-output scenario relies on Claude pipelining a
// confirmation token within a single turn. A human-typed context-dependent
// phrase can't be pre-embedded by an attacker (phrase depends on runtime
// target) and Claude can't silently produce it (requires genuine user input).

/** Target for `remove_account` — the account email being removed. */
export interface RemoveAccountTarget {
  readonly email: string;
}

/** Target for `factory_reset` — no target fields needed; phrase is fixed. */
export type FactoryResetTarget = Record<never, never>;

/** Target for `set_read_only_off` — the account whose writes are re-enabled. */
export interface SetReadOnlyOffTarget {
  readonly account: string;
}

/** Target for cross-domain Drive share — the external recipient's email. */
export interface DrivePermissionsCreateCrossDomainTarget {
  readonly email: string;
}

/**
 * Canonical phrase table.
 *
 * Each entry is a pure phrase-builder. The map is `as const` so callers get
 * a fully typed `ConfirmationOp` union and misspellings fail at compile time.
 */
export const CANONICAL_PHRASES = {
  remove_account: (target: RemoveAccountTarget): string => `remove ${target.email}`,
  factory_reset: (_target: FactoryResetTarget): string => 'yes delete all my google credentials',
  set_read_only_off: (target: SetReadOnlyOffTarget): string => `enable writes for ${target.account}`,
  drive_permissions_create_cross_domain: (target: DrivePermissionsCreateCrossDomainTarget): string =>
    `share with ${target.email}`,
} as const;

/** Discriminated union of every destructive operation that uses a phrase. */
export type ConfirmationOp = keyof typeof CANONICAL_PHRASES;

/** Map from op name to its target shape (for typed callers of `verifyConfirmation`). */
export interface ConfirmationTargetMap {
  remove_account: RemoveAccountTarget;
  factory_reset: FactoryResetTarget;
  set_read_only_off: SetReadOnlyOffTarget;
  drive_permissions_create_cross_domain: DrivePermissionsCreateCrossDomainTarget;
}

/**
 * Discriminated result of `verifyConfirmation`.
 * On mismatch, surface the canonical required phrase so the caller can feed
 * it back into a `confirmation_mismatch` error envelope.
 */
export type VerifyResult = { match: true } | { match: false; required: string };

/**
 * Normalize user-provided confirmation text:
 *  - trim leading / trailing whitespace
 *  - collapse internal runs of whitespace to a single ASCII space
 *
 * Case is preserved intentionally — spec.md §Destructive operations requires
 * case-sensitive exact match. This function does NOT lowercase.
 */
export function normalizeConfirmationInput(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/**
 * Build the canonical phrase for `(op, target)`.
 *
 * Typed against `ConfirmationTargetMap` so TypeScript rejects a target that
 * doesn't match the chosen op.
 */
export function canonicalPhrase<Op extends ConfirmationOp>(
  op: Op,
  target: ConfirmationTargetMap[Op],
): string {
  // The per-op builders have narrower target types; `CANONICAL_PHRASES[op]`
  // widens to the intersection, so we cast to the per-op signature here.
  // Using a typed helper indirection keeps `no-explicit-any` clean.
  const builder = CANONICAL_PHRASES[op] as (t: ConfirmationTargetMap[Op]) => string;
  return builder(target);
}

/**
 * Verify that `provided` (from the tool call's `confirm` parameter) matches
 * the canonical phrase for `(op, target)`.
 *
 * Rules (per spec.md §Destructive operations):
 *   - exact string match
 *   - case-sensitive
 *   - whitespace-normalized: leading/trailing trimmed; internal runs of
 *     whitespace collapsed to a single space
 *   - no substring / superset matching: `remove alice@example.com please`
 *     does NOT match `remove alice@example.com`
 */
export function verifyConfirmation<Op extends ConfirmationOp>(
  op: Op,
  target: ConfirmationTargetMap[Op],
  provided: string,
): VerifyResult {
  const required = canonicalPhrase(op, target);
  if (typeof provided !== 'string') {
    return { match: false, required };
  }
  const normalized = normalizeConfirmationInput(provided);
  if (normalized === required) {
    return { match: true };
  }
  return { match: false, required };
}
