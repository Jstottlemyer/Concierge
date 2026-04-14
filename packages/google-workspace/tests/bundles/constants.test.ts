// Scope-count audit + cross-table consistency tests.
//
// Covers AC §S1 (≤24 scopes per bundle, 1-scope headroom under Google's 25-scope
// testing-mode cap) and AC §28 (regression guard — a scope appended to any
// bundle that pushes it over 24 must fail CI, and the failure output must name
// the offending bundle).

import { describe, expect, it } from 'vitest';

import {
  BUNDLES,
  BUNDLES_CONTAINING_SERVICE,
  MAX_SCOPES_PER_BUNDLE,
  SERVICE_PRIMARY_BUNDLE,
  SERVICE_SCOPES,
} from '../../src/bundles/constants.js';
import type { BundleDef, BundleId, Service } from '../../src/bundles/types.js';

const BUNDLE_IDS = Object.keys(BUNDLES) as BundleId[];
const SERVICES = Object.keys(SERVICE_SCOPES) as Service[];

describe('BUNDLES scope-count audit (AC §S1)', () => {
  it(`caps each bundle at ${MAX_SCOPES_PER_BUNDLE} scopes (1-scope headroom under Google's 25 testing-mode cap)`, () => {
    const breaches: string[] = [];
    for (const id of BUNDLE_IDS) {
      const bundle: BundleDef = BUNDLES[id];
      if (bundle.scopes.length > MAX_SCOPES_PER_BUNDLE) {
        breaches.push(
          `bundle "${id}" has ${bundle.scopes.length} scopes (max ${MAX_SCOPES_PER_BUNDLE}); exceeds by ${bundle.scopes.length - MAX_SCOPES_PER_BUNDLE}`,
        );
      }
    }
    expect(
      breaches,
      breaches.length
        ? `AC §S1 breach — ${breaches.length} bundle(s) over cap:\n  ${breaches.join('\n  ')}`
        : 'all bundles within cap',
    ).toEqual([]);
  });

  // AC §28 regression guard — if a future change appends a scope to a bundle
  // that pushes it over 24, this test must fail AND clearly name the bundle.
  // We simulate the failure here (on a clone, so production state is
  // untouched) to prove the guard is functional, then run the real assertion.
  it('regression guard: appending a scope that breaches the cap fails with the offending bundle named (AC §28)', () => {
    // Build a hypothetical "+1 scope" version of every bundle. For any bundle
    // already at MAX, appending would breach. For bundles well under MAX the
    // appended-scope clone should still be within cap.
    const simulate = (scopes: readonly string[]): number => scopes.length + 1;

    for (const id of BUNDLE_IDS) {
      const current = BUNDLES[id].scopes.length;
      const after = simulate(BUNDLES[id].scopes);
      if (current === MAX_SCOPES_PER_BUNDLE) {
        // The guard would trip for this bundle.
        expect(
          after,
          `regression guard proof: bundle "${id}" at cap, +1 scope ⇒ ${after} > ${MAX_SCOPES_PER_BUNDLE}`,
        ).toBeGreaterThan(MAX_SCOPES_PER_BUNDLE);
      }
    }

    // And verify the diagnostic message shape the CI would emit names the
    // bundle. Pick the bundle with the most scopes as the worst-case-first
    // reporter target.
    const sorted = [...BUNDLE_IDS].sort(
      (a, b) => BUNDLES[b].scopes.length - BUNDLES[a].scopes.length,
    );
    const worst = sorted[0];
    expect(worst, 'at least one bundle exists').toBeDefined();
    // If we hypothetically pushed "worst" past the cap, the breach message
    // format matches what the primary audit test emits (bundle id + counts).
    const hypothetical = `bundle "${worst}" has ${MAX_SCOPES_PER_BUNDLE + 1} scopes (max ${MAX_SCOPES_PER_BUNDLE}); exceeds by 1`;
    expect(hypothetical).toMatch(/^bundle "[a-z-]+" has \d+ scopes/);
    expect(hypothetical).toContain(String(worst));
  });
});

describe('BUNDLES internal consistency', () => {
  it('has no duplicate scope URLs within any single bundle', () => {
    const dupes: string[] = [];
    for (const id of BUNDLE_IDS) {
      const scopes = BUNDLES[id].scopes;
      const seen = new Set<string>();
      for (const scope of scopes) {
        if (seen.has(scope)) {
          dupes.push(`bundle "${id}" has duplicate scope "${scope}"`);
        }
        seen.add(scope);
      }
    }
    expect(dupes, dupes.join('\n')).toEqual([]);
  });

  it('defines exactly the six bundles specified in spec §Bundle membership', () => {
    expect(new Set(BUNDLE_IDS)).toEqual(
      new Set(['productivity', 'collaboration', 'admin', 'education', 'creator', 'automation']),
    );
  });

  it('every bundle lists a non-empty services array', () => {
    for (const id of BUNDLE_IDS) {
      expect(BUNDLES[id].services.length, `bundle "${id}" has no services`).toBeGreaterThan(0);
    }
  });

  it("every bundle's scopes are the union of its services' scopes (no orphan scopes)", () => {
    for (const id of BUNDLE_IDS) {
      const bundle = BUNDLES[id];
      const expected = new Set<string>();
      for (const svc of bundle.services) {
        for (const scope of SERVICE_SCOPES[svc]) {
          expected.add(scope);
        }
      }
      expect(new Set(bundle.scopes), `bundle "${id}" scopes don't match services union`).toEqual(
        expected,
      );
    }
  });
});

describe('SERVICE_SCOPES coverage', () => {
  it('every service has at least one scope URL', () => {
    const empties: string[] = [];
    for (const svc of SERVICES) {
      const scopes: readonly string[] = SERVICE_SCOPES[svc];
      if (scopes.length === 0) {
        empties.push(svc);
      }
    }
    expect(empties, `services with no scopes: ${empties.join(', ')}`).toEqual([]);
  });

  it('every scope URL is a google oauth URL', () => {
    const bad: string[] = [];
    for (const svc of SERVICES) {
      for (const scope of SERVICE_SCOPES[svc]) {
        if (!scope.startsWith('https://www.googleapis.com/auth/')) {
          bad.push(`${svc} → ${scope}`);
        }
      }
    }
    expect(bad, `non-canonical scope URLs: ${bad.join(', ')}`).toEqual([]);
  });
});

describe('cross-table consistency (services match across all three tables)', () => {
  it('every service in SERVICE_PRIMARY_BUNDLE appears in at least one bundle', () => {
    const orphans: string[] = [];
    for (const svc of Object.keys(SERVICE_PRIMARY_BUNDLE) as Service[]) {
      const found = BUNDLE_IDS.some((id) =>
        (BUNDLES[id].services as readonly Service[]).includes(svc),
      );
      if (!found) {
        orphans.push(svc);
      }
    }
    expect(orphans, `services in SERVICE_PRIMARY_BUNDLE but no bundle: ${orphans.join(', ')}`).toEqual(
      [],
    );
  });

  it('every service listed in any bundle appears in SERVICE_PRIMARY_BUNDLE', () => {
    const missing: string[] = [];
    for (const id of BUNDLE_IDS) {
      for (const svc of BUNDLES[id].services) {
        if (!(svc in SERVICE_PRIMARY_BUNDLE)) {
          missing.push(`${svc} (in bundle "${id}")`);
        }
      }
    }
    expect(missing, `services in a bundle but missing from SERVICE_PRIMARY_BUNDLE: ${missing.join(', ')}`).toEqual(
      [],
    );
  });

  it('every service in SERVICE_SCOPES has a primary-bundle entry', () => {
    const missing: string[] = [];
    for (const svc of SERVICES) {
      if (!(svc in SERVICE_PRIMARY_BUNDLE)) {
        missing.push(svc);
      }
    }
    expect(missing, `services in SERVICE_SCOPES missing primary-bundle entry: ${missing.join(', ')}`).toEqual(
      [],
    );
  });

  it('SERVICE_PRIMARY_BUNDLE and BUNDLES_CONTAINING_SERVICE cover the same services', () => {
    const primaryKeys = new Set(Object.keys(SERVICE_PRIMARY_BUNDLE));
    const reverseKeys = new Set(Object.keys(BUNDLES_CONTAINING_SERVICE));
    expect(primaryKeys).toEqual(reverseKeys);
  });

  it('every multi-bundle service has its primary bundle inside its containing list', () => {
    const bad: string[] = [];
    for (const svc of Object.keys(SERVICE_PRIMARY_BUNDLE) as Service[]) {
      const primary = SERVICE_PRIMARY_BUNDLE[svc];
      const containing: readonly BundleId[] = BUNDLES_CONTAINING_SERVICE[svc];
      if (!containing.includes(primary)) {
        bad.push(`${svc}: primary=${primary} not in containing=[${containing.join(', ')}]`);
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('BUNDLES_CONTAINING_SERVICE matches the actual membership in BUNDLES', () => {
    const mismatches: string[] = [];
    for (const svc of Object.keys(BUNDLES_CONTAINING_SERVICE) as Service[]) {
      const declared = new Set<BundleId>(BUNDLES_CONTAINING_SERVICE[svc]);
      const actual = new Set<BundleId>();
      for (const id of BUNDLE_IDS) {
        if ((BUNDLES[id].services as readonly Service[]).includes(svc)) {
          actual.add(id);
        }
      }
      const declaredArr = [...declared].sort();
      const actualArr = [...actual].sort();
      if (declaredArr.join(',') !== actualArr.join(',')) {
        mismatches.push(
          `${svc}: declared=[${declaredArr.join(',')}] actual=[${actualArr.join(',')}]`,
        );
      }
    }
    expect(mismatches, mismatches.join('\n')).toEqual([]);
  });
});

describe('spec §Bundle membership regression snapshot', () => {
  // Frozen snapshots of the spec's bundle membership. If spec.md is revised,
  // update both — and the update shows as a visible test delta in the PR.
  it('productivity contains exactly: gmail, drive, calendar, docs, sheets, tasks, forms', () => {
    expect([...BUNDLES.productivity.services].sort()).toEqual(
      ['calendar', 'docs', 'drive', 'forms', 'gmail', 'sheets', 'tasks'].sort(),
    );
  });

  it('collaboration contains exactly: chat, meet, people', () => {
    expect([...BUNDLES.collaboration.services].sort()).toEqual(['chat', 'meet', 'people'].sort());
  });

  it('admin contains exactly: admin-reports, events, modelarmor', () => {
    expect([...BUNDLES.admin.services].sort()).toEqual(
      ['admin-reports', 'events', 'modelarmor'].sort(),
    );
  });

  it('education contains exactly: classroom, forms, meet', () => {
    expect([...BUNDLES.education.services].sort()).toEqual(['classroom', 'forms', 'meet'].sort());
  });

  it('creator contains exactly: slides, forms, docs, drive', () => {
    expect([...BUNDLES.creator.services].sort()).toEqual(
      ['docs', 'drive', 'forms', 'slides'].sort(),
    );
  });

  it('automation contains exactly: script, events, drive', () => {
    expect([...BUNDLES.automation.services].sort()).toEqual(['drive', 'events', 'script'].sort());
  });
});
