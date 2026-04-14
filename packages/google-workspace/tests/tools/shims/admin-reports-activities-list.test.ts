// TDD — T12 shim: admin_reports_activities_list.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { __resetVersionCacheForTests } from '../../../src/gws/runner.js';
import { GWS_BIN_ENV } from '../../../src/gws/paths.js';
import { installGwsMock, type InstalledGwsMock } from '../../helpers/gws-mock.js';
import {
  makeVersionScenario,
  loadGwsResponseFixture,
} from '../../helpers/gws-mock-scenarios.js';
import { adminReportsActivitiesList } from '../../../src/tools/shims/admin-reports-activities-list.js';
import type { ToolContext } from '../../../src/tools/types.js';

const ctx: ToolContext = { now: '2026-04-13T00:00:00.000Z' };

describe('admin_reports_activities_list shim', () => {
  const priorBin = process.env[GWS_BIN_ENV];
  let mock: InstalledGwsMock | null = null;
  beforeEach(() => { __resetVersionCacheForTests(); });
  afterEach(async () => {
    if (mock !== null) { await mock.uninstall(); mock = null; }
    __resetVersionCacheForTests();
    if (priorBin === undefined) delete process.env[GWS_BIN_ENV];
    else process.env[GWS_BIN_ENV] = priorBin;
  });

  it('is readonly + admin-reports service', () => {
    expect(adminReportsActivitiesList.readonly).toBe(true);
    expect(adminReportsActivitiesList.service).toBe('admin-reports');
  });

  it('lists activities with default user=all + pageSize=50', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'admin-reports', 'activities', 'list',
            '--format', 'json',
            '--params', JSON.stringify({
              userKey: 'all',
              applicationName: 'login',
              maxResults: 50,
            }),
          ],
          stdout: loadGwsResponseFixture('admin.reports.activities.list'),
          exitCode: 0,
        },
      ],
    });
    const result = await adminReportsActivitiesList.invoke(
      { application_name: 'login' },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('x');
    expect(result.data.items).toHaveLength(2);
    expect(result.data.has_more).toBe(true);
    expect(result.data.next_page_token).toContain('A:');
  });

  it('rejects missing application_name', () => {
    expect(adminReportsActivitiesList.input.safeParse({}).success).toBe(false);
  });

  it('forwards pagination and filters', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'admin-reports', 'activities', 'list',
            '--format', 'json',
            '--params', JSON.stringify({
              userKey: 'audited-user@example.com',
              applicationName: 'drive',
              maxResults: 20,
              pageToken: 'p1',
              eventName: 'view',
            }),
          ],
          stdout: loadGwsResponseFixture('admin.reports.activities.list'),
          exitCode: 0,
        },
      ],
    });
    const result = await adminReportsActivitiesList.invoke(
      {
        user_key: 'audited-user@example.com',
        application_name: 'drive',
        max_results: 20,
        page_token: 'p1',
        event_name: 'view',
      },
      ctx,
    );
    expect(result.ok).toBe(true);
  });
});
