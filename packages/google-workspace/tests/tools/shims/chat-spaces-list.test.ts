// TDD — T12 shim: chat_spaces_list (pagination).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { __resetVersionCacheForTests } from '../../../src/gws/runner.js';
import { GWS_BIN_ENV } from '../../../src/gws/paths.js';
import { installGwsMock, type InstalledGwsMock } from '../../helpers/gws-mock.js';
import {
  makeVersionScenario,
  loadGwsResponseFixture,
} from '../../helpers/gws-mock-scenarios.js';
import { chatSpacesList } from '../../../src/tools/shims/chat-spaces-list.js';
import type { ToolContext } from '../../../src/tools/types.js';

const ctx: ToolContext = { now: '2026-04-13T00:00:00.000Z' };

describe('chat_spaces_list shim', () => {
  const priorBin = process.env[GWS_BIN_ENV];
  let mock: InstalledGwsMock | null = null;
  beforeEach(() => { __resetVersionCacheForTests(); });
  afterEach(async () => {
    if (mock !== null) { await mock.uninstall(); mock = null; }
    __resetVersionCacheForTests();
    if (priorBin === undefined) delete process.env[GWS_BIN_ENV];
    else process.env[GWS_BIN_ENV] = priorBin;
  });

  it('is readonly + chat service', () => {
    expect(chatSpacesList.readonly).toBe(true);
    expect(chatSpacesList.service).toBe('chat');
  });

  it('defaults pageSize to 50; reports has_more=false when no nextPageToken', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'chat', 'spaces', 'list',
            '--format', 'json',
            '--params', JSON.stringify({ pageSize: 50 }),
          ],
          stdout: loadGwsResponseFixture('chat.spaces.list'),
          exitCode: 0,
        },
      ],
    });
    const result = await chatSpacesList.invoke({}, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('x');
    expect(result.data.spaces).toHaveLength(2);
    expect(result.data.next_page_token).toBe('');
    expect(result.data.has_more).toBe(false);
  });

  it('passes filter + page_token', async () => {
    mock = await installGwsMock({
      scenarios: [
        makeVersionScenario(),
        {
          matchArgs: [
            'chat', 'spaces', 'list',
            '--format', 'json',
            '--params', JSON.stringify({
              pageSize: 25,
              pageToken: 'tok',
              filter: 'spaceType = "SPACE"',
            }),
          ],
          stdout: loadGwsResponseFixture('chat.spaces.list'),
          exitCode: 0,
        },
      ],
    });
    const result = await chatSpacesList.invoke(
      { max_results: 25, page_token: 'tok', filter: 'spaceType = "SPACE"' },
      ctx,
    );
    expect(result.ok).toBe(true);
  });
});
