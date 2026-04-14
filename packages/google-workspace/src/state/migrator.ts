// Forward-only state migrator.
//
// Each entry in `migrations` transforms an N→N+1 shape. v1 has no migrations
// (it is the current version), but the harness is registered so v2 can plug
// in without touching the loader.
//
// Contract:
//   - Input to migration N: the raw parsed JSON at schema version N.
//   - Output: raw unknown at schema version N+1 (Zod will validate after the
//     full chain runs).
//   - Migrations never mutate their input.

import { ConciergeError } from '@concierge/core/errors';
import { CURRENT_STATE_SCHEMA_VERSION, SchemaVersionProbeSchema } from './schema.js';

/** A single migration step: read shape at version N, return shape at N+1. */
export type MigrationStep = (raw: unknown) => unknown;

/**
 * Registered migrations keyed by source version. `migrations[1]` would turn a
 * v1 document into v2, etc. Empty in v1; new entries added in lockstep with
 * new schema versions.
 */
export const migrations: Record<number, MigrationStep> = {};

/**
 * Read `state_schema_version` from a raw parsed JSON blob. Returns `null` if
 * the field is missing or not a positive integer — callers treat that as a
 * corrupt/unknown document.
 */
export function probeSchemaVersion(raw: unknown): number | null {
  const parsed = SchemaVersionProbeSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data.state_schema_version;
}

/**
 * Run every registered migration from `fromVersion` up to the current schema
 * version. Returns the raw (unvalidated) document at the current version;
 * the loader is responsible for the final Zod parse.
 *
 * Throws:
 *   - `ConciergeError("state_schema_too_new")` if the document is at a
 *     version newer than this build knows about.
 *   - `ConciergeError("state_migration_gap")` if a required intermediate
 *     migration is missing (e.g. jumping from v1 to v3 with no v1→v2 step).
 */
export function migrateToCurrent(raw: unknown, fromVersion: number): unknown {
  if (fromVersion === CURRENT_STATE_SCHEMA_VERSION) {
    return raw;
  }
  if (fromVersion > CURRENT_STATE_SCHEMA_VERSION) {
    throw new ConciergeError(
      'state_schema_too_new',
      `state.json schema version ${String(fromVersion)} is newer than this build (${String(CURRENT_STATE_SCHEMA_VERSION)}); upgrade Concierge or see the out-of-band recovery procedure`,
    );
  }

  let current: unknown = raw;
  for (let v = fromVersion; v < CURRENT_STATE_SCHEMA_VERSION; v++) {
    const step = migrations[v];
    if (!step) {
      throw new ConciergeError(
        'state_migration_gap',
        `missing migration from state schema v${String(v)} to v${String(v + 1)}`,
      );
    }
    current = step(current);
  }
  return current;
}
