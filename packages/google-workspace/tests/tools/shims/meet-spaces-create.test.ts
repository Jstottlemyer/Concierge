// TDD — T12 shim: meet_spaces_create.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { __resetVersionCacheForTests } from '../../../src/gws/runner.js';
import { GWS_BIN_ENV } from '../../../src/gws/paths.js';
import { installGwsMock, type InstalledGwsMock } from '../../helpers/gws-mock.js';
import {
  makeVersionScenario,
  loadGwsResponseFixture,
} from '../../helpers/gws-mock-scenarios.js';
import { meetSpacesCreate } from '../../../src/tools/shims/meet-spaces-create.js';
import type { ToolContext } from '../../../src/tools/types.js';

const ctx: ToolContext = { now: '2026-04-13T00:00:00.000Z' };

describe('meet_spaces_create shim', () => {
  const priorBin = process.env[GWS_BIN_ENV];
  let mock: InstalledGwsMock | null = null;
  beforeEach(() => { __resetVersionCacheForTests(); });
  afterEach(async () => {
    if (mock !== null) { await mock.uninstall(); mock = null; }
    __resetVersionCacheForTests();
    if (priorBin === undefined) delete process.env[GWS_BIN_ENV];
    else process.env[GWS_BIN_ENV] = priorBin;
  });

  it('is write + meet service', () => {
    expect(meetSpacesCreate.readonly).toBe(false);
    expect(meetSpacesCreate.service).toBe('meet');
  });

  it('creates a space with no options', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'meet', 'spaces', 'create',
            '--format', 'json',
            '--params', JSON.stringify({}),
            '--json', JSON.stringify({}),
          ],
          stdout: loadGwsResponseFixture('meet.spaces.create'),
          exitCode: 0,
        },
      ],
    });
    const result = await meetSpacesCreate.invoke({}, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('x');
    expect(result.data.name).toBe('spaces/FAKEMEETSPACEABCDE');
    expect(result.data.meetingUri).toContain('meet.google.com');
  });

  it('passes access_type through the request body', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'meet', 'spaces', 'create',
            '--format', 'json',
            '--params', JSON.stringify({}),
            '--json', JSON.stringify({ config: { accessType: 'OPEN' } }),
          ],
          stdout: loadGwsResponseFixture('meet.spaces.create'),
          exitCode: 0,
        },
      ],
    });
    const result = await meetSpacesCreate.invoke({ access_type: 'OPEN' }, ctx);
    expect(result.ok).toBe(true);
  });

  it('rejects invalid access_type', () => {
    expect(meetSpacesCreate.input.safeParse({ access_type: 'bogus' }).success).toBe(false);
  });
});
