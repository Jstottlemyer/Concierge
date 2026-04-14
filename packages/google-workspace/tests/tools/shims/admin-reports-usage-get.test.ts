// TDD — T12 shim: admin_reports_usage_get.
//
// Wraps `gws admin-reports userUsageReport get` (camelCase singular — see
// T7.5 notes).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { __resetVersionCacheForTests } from '../../../src/gws/runner.js';
import { GWS_BIN_ENV } from '../../../src/gws/paths.js';
import { installGwsMock, type InstalledGwsMock } from '../../helpers/gws-mock.js';
import {
  makeVersionScenario,
  loadGwsResponseFixture,
} from '../../helpers/gws-mock-scenarios.js';
import { adminReportsUsageGet } from '../../../src/tools/shims/admin-reports-usage-get.js';
import type { ToolContext } from '../../../src/tools/types.js';

const ctx: ToolContext = { now: '2026-04-13T00:00:00.000Z' };

describe('admin_reports_usage_get shim', () => {
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
    expect(adminReportsUsageGet.readonly).toBe(true);
    expect(adminReportsUsageGet.service).toBe('admin-reports');
  });

  it('fetches a user usage report (CLI uses camelCase userUsageReport get)', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'admin-reports', 'userUsageReport', 'get',
            '--format', 'json',
            '--params', JSON.stringify({
              userKey: 'audited-user@example.com',
              date: '2026-04-09',
            }),
          ],
          stdout: loadGwsResponseFixture('admin.reports.usageReports.get'),
          exitCode: 0,
        },
      ],
    });
    const result = await adminReportsUsageGet.invoke(
      { user_key: 'audited-user@example.com', date: '2026-04-09' },
      ctx,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('x');
    expect(result.data.usageReports?.length).toBeGreaterThan(0);
  });

  it('rejects missing user_key or date', () => {
    expect(adminReportsUsageGet.input.safeParse({ date: '2026-04-09' }).success).toBe(false);
    expect(adminReportsUsageGet.input.safeParse({ user_key: 'a@b.com' }).success).toBe(false);
  });

  it('forwards filter parameter', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'admin-reports', 'userUsageReport', 'get',
            '--format', 'json',
            '--params', JSON.stringify({
              userKey: 'a@b.com',
              date: '2026-04-09',
              parameters: 'gmail:num_emails_received',
            }),
          ],
          stdout: loadGwsResponseFixture('admin.reports.usageReports.get'),
          exitCode: 0,
        },
      ],
    });
    const result = await adminReportsUsageGet.invoke(
      {
        user_key: 'a@b.com',
        date: '2026-04-09',
        parameters: 'gmail:num_emails_received',
      },
      ctx,
    );
    expect(result.ok).toBe(true);
  });
});
