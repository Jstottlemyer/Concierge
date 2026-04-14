// T31.5 — admin-bundle drift detector.
//
// The Admin Reports bundle (`admin_reports_activities_list`,
// `admin_reports_usage_get`) ships with *mock-only* coverage in v1. Real-
// tenant validation is deferred until CEO-level Google Workspace access
// is onboarded (plan.md Decisions #2, risks row "Admin bundle drift").
//
// This test is the only automated signal that fires when the committed
// fixture responses might have drifted from what the real `gws` binary
// actually emits. It is intentionally brittle — if this test fails, the
// correct response is a human review, not a quick green-up.
//
// Checks:
//
//   1. **Shape fidelity** — each committed admin fixture parses cleanly
//      through its shim's schema. For `admin_reports_usage_get` this is
//      the top-level `OutputSchema` (passthrough shape, identical to the
//      raw API response). For `admin_reports_activities_list` the shim
//      wraps the raw response through a pagination normalizer, so we run
//      the fixture through the same shim (via `runGws` + mock harness)
//      and assert the resulting `OutputSchema` parses.
//
//   2. **Version freeze** — `ADMIN_TOOLS_FROZEN_AT` pins the exact gws
//      version at which the fixtures were captured. If someone bumps
//      the bundled gws and does NOT rerun the manual admin-bundle
//      real-tenant procedure, they also have to bump this constant —
//      and that bump should be a conscious PR review touchpoint. Test
//      asserts the constant hasn't been silently edited to a future
//      version without a fixture refresh.
//
// Spec refs: plan.md T31.5, Decisions #2 + #11, Risk row "Admin bundle
// drift between `gws` versions (mocks only)".

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { __resetVersionCacheForTests } from '../../src/gws/runner.js';
import { GWS_BIN_ENV } from '../../src/gws/paths.js';
import {
  adminReportsActivitiesList,
  AdminReportsActivitiesListOutputSchema,
} from '../../src/tools/shims/admin-reports-activities-list.js';
import { AdminReportsUsageGetOutputSchema } from '../../src/tools/shims/admin-reports-usage-get.js';
import type { ToolContext } from '../../src/tools/types.js';
import { installGwsMock, type InstalledGwsMock } from '../helpers/gws-mock.js';
import {
  loadGwsResponseFixture,
  makeVersionScenario,
} from '../helpers/gws-mock-scenarios.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(HERE, '..', 'fixtures', 'gws-responses');

/**
 * Frozen gws version at which the admin-bundle fixtures were last
 * captured AND manually validated against a real Workspace tenant.
 *
 * IF YOU BUMP THIS, YOU MUST ALSO:
 *   1. Refresh both admin fixture JSON files by recapturing from the new
 *      gws release against a real tenant (the T31.5 manual procedure).
 *   2. Note the refresh in the release notes with the
 *      `[UNVERIFIED-REAL-TENANT]` marker removed for any admin tools
 *      that gained fresh capture coverage.
 *   3. Land both changes in the SAME commit so reviewers can correlate
 *      the bump with new fixture bytes.
 *
 * This constant is spec-adjacent, not code-adjacent. Do not refactor
 * it into a shared module — the whole point is that it sits in the
 * drift test where reviewers see it.
 */
const ADMIN_TOOLS_FROZEN_AT = '0.22.5';

/** Shape of the committed admin.reports.activities.list fixture. */
const ADMIN_ACTIVITIES_FIXTURE = 'admin.reports.activities.list';
/** Shape of the committed admin.reports.usageReports.get fixture. */
const ADMIN_USAGE_FIXTURE = 'admin.reports.usageReports.get';

const ctx: ToolContext = { now: '2026-04-13T00:00:00.000Z' };

describe('T31.5 admin-bundle drift detector', () => {
  it('fixture files are present on disk', () => {
    // If either file is missing the remaining tests would throw from
    // readFileSync with a confusing stack. This test turns that into a
    // clear up-front failure.
    const activitiesPath = join(FIXTURES_DIR, `${ADMIN_ACTIVITIES_FIXTURE}.json`);
    const usagePath = join(FIXTURES_DIR, `${ADMIN_USAGE_FIXTURE}.json`);
    expect(() => readFileSync(activitiesPath, 'utf8')).not.toThrow();
    expect(() => readFileSync(usagePath, 'utf8')).not.toThrow();
  });

  it('ADMIN_TOOLS_FROZEN_AT matches the mock version fixture', () => {
    // The mock version scenario hands back `gws 0.22.5-fake` by default.
    // The frozen constant is the *real* version number (no `-fake`
    // suffix). Assert they match after stripping the suffix so that a
    // bump to either (the mock default or this file) is an intentional,
    // correlated change.
    const mockVersion = makeVersionScenario().stdout ?? '';
    const stripped = mockVersion.replace(/-fake/g, '').trim();
    expect(
      stripped,
      `ADMIN_TOOLS_FROZEN_AT=${ADMIN_TOOLS_FROZEN_AT} must match the version fixture (got "${stripped}")`,
    ).toBe(`gws ${ADMIN_TOOLS_FROZEN_AT}`);
  });

  it('admin_reports_usage_get fixture parses against its OutputSchema', () => {
    // The usage-get shim is `passthrough`; the raw Google API response
    // shape IS the output shape. A drift here is a direct red flag.
    const raw = loadGwsResponseFixture(ADMIN_USAGE_FIXTURE);
    const parsed = JSON.parse(raw) as unknown;
    const result = AdminReportsUsageGetOutputSchema.safeParse(parsed);
    expect(
      result.success,
      result.success ? '' : `schema drift in ${ADMIN_USAGE_FIXTURE}: ${result.error.message}`,
    ).toBe(true);
  });

  it('admin_reports_usage_get fixture contains at least one usage report', () => {
    // Structural sanity check the schema parse cannot catch (all array
    // fields are optional). A fixture that drifts to an empty report
    // array is technically valid but useless for coverage.
    const raw = loadGwsResponseFixture(ADMIN_USAGE_FIXTURE);
    const parsed = JSON.parse(raw) as { usageReports?: unknown[] };
    expect(parsed.usageReports?.length ?? 0).toBeGreaterThan(0);
  });

  describe('admin_reports_activities_list shim', () => {
    const priorBin = process.env[GWS_BIN_ENV];
    let mock: InstalledGwsMock | null = null;

    beforeEach(() => {
      __resetVersionCacheForTests();
    });

    afterEach(async () => {
      if (mock !== null) {
        await mock.uninstall();
        mock = null;
      }
      __resetVersionCacheForTests();
      if (priorBin === undefined) {
        delete process.env[GWS_BIN_ENV];
      } else {
        process.env[GWS_BIN_ENV] = priorBin;
      }
    });

    it('fixture flows through the shim and the output parses against OutputSchema', async () => {
      // The activities-list shim applies a pagination normalization step
      // (`nextPageToken` → `{next_page_token, has_more}`), so the raw
      // fixture shape is NOT the output shape. Run the fixture through
      // the real shim via the mock harness and validate the transformed
      // output instead.
      mock = await installGwsMock({
        scenarios: [
          makeVersionScenario(),
          {
            matchArgs: [
              'admin-reports',
              'activities',
              'list',
              '--format',
              'json',
              '--params',
              JSON.stringify({
                userKey: 'all',
                applicationName: 'login',
                maxResults: 50,
              }),
            ],
            stdout: loadGwsResponseFixture(ADMIN_ACTIVITIES_FIXTURE),
            exitCode: 0,
          },
        ],
      });

      const result = await adminReportsActivitiesList.invoke(
        { application_name: 'login' },
        ctx,
      );
      expect(result.ok, result.ok ? '' : JSON.stringify(result.error)).toBe(true);
      if (!result.ok) throw new Error('unreachable after the assertion above');

      // Drift check — the transformed output must parse against the
      // shim's own OutputSchema. Pagination fields present; items array
      // present. If the raw fixture grows/loses fields that confuse
      // `normalizePaginationResponse`, this fails.
      const shaped = AdminReportsActivitiesListOutputSchema.safeParse(result.data);
      expect(
        shaped.success,
        shaped.success ? '' : `OutputSchema parse failed: ${shaped.error.message}`,
      ).toBe(true);

      expect(result.data.items.length).toBeGreaterThan(0);
      expect(typeof result.data.has_more).toBe('boolean');
      expect(typeof result.data.next_page_token).toBe('string');
    });

    it('fixture next-page token round-trips into pagination output', async () => {
      // If the admin fixture loses its nextPageToken in a future gws
      // version, `has_more` would silently become `false` and the shim
      // consumers would page incorrectly. Guard against that.
      mock = await installGwsMock({
        scenarios: [
          makeVersionScenario(),
          {
            matchArgs: [
              'admin-reports',
              'activities',
              'list',
              '--format',
              'json',
              '--params',
              JSON.stringify({
                userKey: 'all',
                applicationName: 'login',
                maxResults: 50,
              }),
            ],
            stdout: loadGwsResponseFixture(ADMIN_ACTIVITIES_FIXTURE),
            exitCode: 0,
          },
        ],
      });

      const result = await adminReportsActivitiesList.invoke(
        { application_name: 'login' },
        ctx,
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error('unreachable');
      expect(result.data.has_more).toBe(true);
      expect(result.data.next_page_token.length).toBeGreaterThan(0);
    });
  });
});
