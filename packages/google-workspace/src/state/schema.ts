// Concierge state.json v1 schema (Zod).
//
// Persisted structure per spec §Data & State:
//   {
//     "state_schema_version": 1,
//     "default_account": "alice@example.com" | null,
//     "accounts": {
//       "alice@example.com": { "read_only": false }
//     }
//   }
//
// Referential integrity: if `default_account` is non-null it MUST appear as a
// key in `accounts`. Enforced via `.superRefine()` so Zod returns a typed
// issue we can recover from (self-repair in the loader).

import { z } from 'zod';

/** Current on-disk schema version for Concierge state. */
export const CURRENT_STATE_SCHEMA_VERSION = 1 as const;

/** Per-account preferences stored in state.json. */
export const AccountEntrySchema = z
  .object({
    read_only: z.boolean(),
  })
  .strict();

export type AccountEntry = z.infer<typeof AccountEntrySchema>;

/**
 * Email key validation. Google account IDs fit comfortably inside the
 * RFC-5322-light profile: non-empty local part, @, non-empty domain with a
 * dot. We intentionally keep this simple — `gws` is the source of truth for
 * "is this an account gws knows about".
 */
export const EmailSchema = z
  .string()
  .min(3, 'email must be non-empty')
  .max(254, 'email exceeds 254 chars')
  .email('invalid email');

/** Accounts map: email → preferences. */
export const AccountsMapSchema = z.record(EmailSchema, AccountEntrySchema);

export type AccountsMap = z.infer<typeof AccountsMapSchema>;

/**
 * Full v1 state. Referential-integrity invariant (default_account ∈ accounts)
 * is validated at the object level.
 */
export const StateV1Schema = z
  .object({
    state_schema_version: z.literal(1),
    default_account: EmailSchema.nullable(),
    accounts: AccountsMapSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.default_account !== null && !(value.default_account in value.accounts)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['default_account'],
        message: 'default_account must be a key in accounts',
        params: { concierge: 'referential_integrity' },
      });
    }
  });

export type StateV1 = z.infer<typeof StateV1Schema>;

/**
 * Build a fresh v1 state with no accounts. Used on first-run (file missing)
 * and by `factory_reset`.
 */
export function freshStateV1(): StateV1 {
  return {
    state_schema_version: CURRENT_STATE_SCHEMA_VERSION,
    default_account: null,
    accounts: {},
  };
}

/**
 * Lightweight top-level check used when peeking at the raw parsed JSON to
 * decide which migration branch to take. Intentionally permissive: we only
 * need a readable `state_schema_version` number here; StateV1Schema enforces
 * the rest after migration.
 */
export const SchemaVersionProbeSchema = z
  .object({
    state_schema_version: z.number().int().positive(),
  })
  .loose();

export type SchemaVersionProbe = z.infer<typeof SchemaVersionProbeSchema>;
