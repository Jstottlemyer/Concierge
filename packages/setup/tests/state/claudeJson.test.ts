import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createMemFs } from '../helpers/memfs.js';

// Per G0 docs: memfs uses `vi.doMock`, which is NOT hoisted. To make the
// substitution active at SUT module-load time, we dynamic-import the SUT
// AFTER `install()` inside each test.

const memfs = createMemFs();

const HOME = '/Users/test';
const CLAUDE_JSON = `${HOME}/.claude.json`;
const EXPECTED =
  '/Users/test/.local/share/concierge/mcpb/0.2.0/dist/index.js';

beforeEach(() => {
  memfs.reset();
  memfs.install();
});

afterEach(() => {
  memfs.uninstall();
});

async function loadSut(): Promise<
  typeof import('../../src/state/claudeJson.js')
> {
  return await import('../../src/state/claudeJson.js');
}

describe('probeClaudeRegistration', () => {
  it('returns { kind: "absent" } when ~/.claude.json does not exist', async () => {
    const { probeClaudeRegistration } = await loadSut();
    const state = await probeClaudeRegistration(HOME, EXPECTED);
    expect(state).toEqual({ kind: 'absent' });
  });

  it('returns { kind: "no_concierge", otherServers: [] } when file has no mcpServers key', async () => {
    memfs.preload({
      [CLAUDE_JSON]: JSON.stringify({ theme: 'dark', other: 'thing' }),
    });
    const { probeClaudeRegistration } = await loadSut();
    const state = await probeClaudeRegistration(HOME, EXPECTED);
    expect(state).toEqual({ kind: 'no_concierge', otherServers: [] });
  });

  it('returns { kind: "no_concierge", otherServers: [...] } when mcpServers exists but has no concierge entry', async () => {
    memfs.preload({
      [CLAUDE_JSON]: JSON.stringify({
        mcpServers: {
          context7: { type: 'stdio', command: 'node', args: ['/x.js'] },
          playwright: { type: 'stdio', command: 'node', args: ['/y.js'] },
        },
      }),
    });
    const { probeClaudeRegistration } = await loadSut();
    const state = await probeClaudeRegistration(HOME, EXPECTED);
    expect(state.kind).toBe('no_concierge');
    if (state.kind === 'no_concierge') {
      expect([...state.otherServers].sort()).toEqual(['context7', 'playwright']);
    }
  });

  it('returns { kind: "registered", matches: true } when args[0] equals expectedAbsPath', async () => {
    memfs.preload({
      [CLAUDE_JSON]: JSON.stringify({
        mcpServers: {
          concierge: {
            type: 'stdio',
            command: 'node',
            args: [EXPECTED],
            scope: 'user',
          },
          other: { type: 'stdio', command: 'node', args: ['/z.js'] },
        },
      }),
    });
    const { probeClaudeRegistration } = await loadSut();
    const state = await probeClaudeRegistration(HOME, EXPECTED);
    expect(state).toEqual({
      kind: 'registered',
      expectedAbsPath: EXPECTED,
      actualAbsPath: EXPECTED,
      matches: true,
    });
  });

  it('returns { kind: "registered", matches: false } when args[0] is a different (stale) path', async () => {
    const stale =
      '/Users/test/.local/share/concierge/mcpb/0.1.0/dist/index.js';
    memfs.preload({
      [CLAUDE_JSON]: JSON.stringify({
        mcpServers: {
          concierge: {
            type: 'stdio',
            command: 'node',
            args: [stale],
            scope: 'user',
          },
        },
      }),
    });
    const { probeClaudeRegistration } = await loadSut();
    const state = await probeClaudeRegistration(HOME, EXPECTED);
    expect(state).toEqual({
      kind: 'registered',
      expectedAbsPath: EXPECTED,
      actualAbsPath: stale,
      matches: false,
    });
  });

  it('throws (does not return a state) when ~/.claude.json contains malformed JSON', async () => {
    memfs.preload({
      [CLAUDE_JSON]: '{ this is : not valid json,,, ',
    });
    const { probeClaudeRegistration } = await loadSut();
    await expect(probeClaudeRegistration(HOME, EXPECTED)).rejects.toBeInstanceOf(
      SyntaxError,
    );
  });

  it('returns registered with actualAbsPath: "" + matches: false when concierge entry is missing command/args (defensive)', async () => {
    memfs.preload({
      [CLAUDE_JSON]: JSON.stringify({
        mcpServers: {
          // Defensive case: a half-written entry with no command or args at all.
          concierge: { type: 'stdio' },
        },
      }),
    });
    const { probeClaudeRegistration } = await loadSut();
    const state = await probeClaudeRegistration(HOME, EXPECTED);
    expect(state).toEqual({
      kind: 'registered',
      expectedAbsPath: EXPECTED,
      actualAbsPath: '',
      matches: false,
    });
  });

  it('returns registered with actualAbsPath: "" when args is present but empty', async () => {
    memfs.preload({
      [CLAUDE_JSON]: JSON.stringify({
        mcpServers: {
          concierge: { type: 'stdio', command: 'node', args: [] },
        },
      }),
    });
    const { probeClaudeRegistration } = await loadSut();
    const state = await probeClaudeRegistration(HOME, EXPECTED);
    expect(state).toEqual({
      kind: 'registered',
      expectedAbsPath: EXPECTED,
      actualAbsPath: '',
      matches: false,
    });
  });
});
