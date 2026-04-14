// T8: PROGRESS_VALUES invariants test.
//
// Asserts the three invariants documented in src/mcp/progress-values.ts:
//   1. monotonic increase across stages (in declaration order)
//   2. progress ≤ total per stage
//   3. total === 1 for every stage
//
// Plus a spot check that the terminal failure stage pins to 1.0.

import { describe, expect, it } from 'vitest';

import type { ProgressStage } from '../../src/mcp/progress.js';
import { PROGRESS_VALUES } from '../../src/mcp/progress-values.js';

describe('PROGRESS_VALUES', () => {
  it('has an entry for every ProgressStage (6 total: 5 normal + 1 failure)', () => {
    const keys = Object.keys(PROGRESS_VALUES);
    expect(keys).toHaveLength(6);
    expect(keys).toEqual([
      'detecting_grant',
      'launching_browser',
      'awaiting_consent',
      'persisting_token',
      'retrying_call',
      'failed_consent_denied',
    ]);
  });

  it('progress values are strictly monotonically increasing in declaration order', () => {
    const entries = Object.values(PROGRESS_VALUES);
    for (let i = 1; i < entries.length; i += 1) {
      const prev = entries[i - 1];
      const curr = entries[i];
      expect(prev).toBeDefined();
      expect(curr).toBeDefined();
      // TS noUncheckedIndexedAccess safety: guard before index access.
      if (prev !== undefined && curr !== undefined) {
        expect(curr.progress).toBeGreaterThan(prev.progress);
      }
    }
  });

  it('progress ≤ total for every stage', () => {
    for (const [, value] of Object.entries(PROGRESS_VALUES)) {
      expect(value.progress).toBeLessThanOrEqual(value.total);
    }
  });

  it('total === 1 for every stage', () => {
    for (const [, value] of Object.entries(PROGRESS_VALUES)) {
      expect(value.total).toBe(1);
    }
  });

  it('terminal failed_consent_denied stage pins to progress = 1.0', () => {
    expect(PROGRESS_VALUES.failed_consent_denied).toEqual({ progress: 1.0, total: 1 });
  });

  it('first stage starts at a small but non-zero value', () => {
    // Sanity: the client should see immediate feedback when the flow starts,
    // but not 0 (which some progress UIs treat as "not started").
    expect(PROGRESS_VALUES.detecting_grant.progress).toBeGreaterThan(0);
    expect(PROGRESS_VALUES.detecting_grant.progress).toBeLessThan(0.2);
  });

  it('exposes the documented canonical values', () => {
    // Freezes the contract: if these values change, update the docstring
    // in progress-values.ts and ensure client copy still reads well.
    const expected: Record<ProgressStage, { progress: number; total: number }> = {
      detecting_grant: { progress: 0.1, total: 1 },
      launching_browser: { progress: 0.25, total: 1 },
      awaiting_consent: { progress: 0.5, total: 1 },
      persisting_token: { progress: 0.8, total: 1 },
      retrying_call: { progress: 0.95, total: 1 },
      failed_consent_denied: { progress: 1.0, total: 1 },
    };
    expect(PROGRESS_VALUES).toEqual(expected);
  });
});
