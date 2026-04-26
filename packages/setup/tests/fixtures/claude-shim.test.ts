import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const execFileAsync = promisify(execFile);

// Resolve the shim relative to repo root: packages/setup/tests/fixtures/ -> ../../../../tests/fixtures/bin/claude
const SHIM = resolve(__dirname, '../../../../tests/fixtures/bin/claude');

interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

async function runShim(args: string[], env: NodeJS.ProcessEnv = {}): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync(SHIM, args, {
      env: { ...process.env, ...env },
      encoding: 'utf8',
    });
    return { stdout, stderr, code: 0 };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      code: typeof e.code === 'number' ? e.code : 1,
    };
  }
}

describe('claude test shim', () => {
  let tmp: string;
  let claudeJson: string;
  let snapshotRealClaudeJson: { existed: boolean; mtimeMs?: number; size?: number };

  // Snapshot the real ~/.claude.json once so we can verify nothing touched it.
  const realClaudeJson = join(process.env['HOME'] ?? '/nonexistent-home-aaa', '.claude.json');

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'claude-shim-test-'));
    claudeJson = join(tmp, 'claude.json');
    if (existsSync(realClaudeJson)) {
      const st = statSync(realClaudeJson);
      snapshotRealClaudeJson = { existed: true, mtimeMs: st.mtimeMs, size: st.size };
    } else {
      snapshotRealClaudeJson = { existed: false };
    }
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    // Verify real ~/.claude.json was not mutated.
    if (snapshotRealClaudeJson.existed) {
      expect(existsSync(realClaudeJson)).toBe(true);
      const st = statSync(realClaudeJson);
      expect(st.mtimeMs).toBe(snapshotRealClaudeJson.mtimeMs);
      expect(st.size).toBe(snapshotRealClaudeJson.size);
    } else {
      expect(existsSync(realClaudeJson)).toBe(false);
    }
  });

  it('--version returns expected string and exits 0', async () => {
    const res = await runShim(['--version']);
    expect(res.code).toBe(0);
    expect(res.stdout.trim()).toBe('claude 1.0.42 (test shim)');
  });

  it('mcp add writes the expected JSON shape', async () => {
    const res = await runShim(
      ['mcp', 'add', '--transport', 'stdio', 'concierge', '--scope', 'user', '--', 'node', '/abs/path/dist/index.js'],
      { CONCIERGE_TEST_CLAUDE_JSON: claudeJson },
    );
    expect(res.code).toBe(0);
    const doc = JSON.parse(readFileSync(claudeJson, 'utf8'));
    expect(doc).toEqual({
      mcpServers: {
        concierge: {
          type: 'stdio',
          command: 'node',
          args: ['/abs/path/dist/index.js'],
          scope: 'user',
        },
      },
    });
  });

  it('mcp add with existing key exits 1 with documented stderr', async () => {
    writeFileSync(
      claudeJson,
      JSON.stringify({
        mcpServers: {
          concierge: { type: 'stdio', command: 'node', args: [], scope: 'user' },
        },
      }),
    );
    const res = await runShim(
      ['mcp', 'add', '--transport', 'stdio', 'concierge', '--scope', 'user', '--', 'node', '/x.js'],
      { CONCIERGE_TEST_CLAUDE_JSON: claudeJson },
    );
    expect(res.code).toBe(1);
    expect(res.stderr).toContain(
      "Error: server 'concierge' already registered. Use 'claude mcp remove concierge' first.",
    );
  });

  it('mcp remove deletes key, preserves unrelated mcpServers entries', async () => {
    writeFileSync(
      claudeJson,
      JSON.stringify({
        mcpServers: {
          concierge: { type: 'stdio', command: 'node', args: [], scope: 'user' },
          foo: { type: 'stdio', command: 'other', args: ['x'], scope: 'project' },
        },
        unrelatedTopLevel: { keep: true },
      }),
    );
    const res = await runShim(['mcp', 'remove', 'concierge'], {
      CONCIERGE_TEST_CLAUDE_JSON: claudeJson,
    });
    expect(res.code).toBe(0);
    const doc = JSON.parse(readFileSync(claudeJson, 'utf8'));
    expect(doc.mcpServers).toEqual({
      foo: { type: 'stdio', command: 'other', args: ['x'], scope: 'project' },
    });
    expect(doc.unrelatedTopLevel).toEqual({ keep: true });
  });

  it('mcp remove of non-existent key exits 1 with documented stderr', async () => {
    writeFileSync(claudeJson, JSON.stringify({ mcpServers: {} }));
    const res = await runShim(['mcp', 'remove', 'ghost'], {
      CONCIERGE_TEST_CLAUDE_JSON: claudeJson,
    });
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("Error: server 'ghost' not registered.");
  });

  it('mcp list returns one key per line', async () => {
    writeFileSync(
      claudeJson,
      JSON.stringify({
        mcpServers: {
          concierge: { type: 'stdio', command: 'a', args: [], scope: 'user' },
          foo: { type: 'stdio', command: 'b', args: [], scope: 'user' },
        },
      }),
    );
    const res = await runShim(['mcp', 'list'], { CONCIERGE_TEST_CLAUDE_JSON: claudeJson });
    expect(res.code).toBe(0);
    expect(res.stdout.trim().split('\n').sort()).toEqual(['concierge', 'foo']);
  });

  it('unknown subcommand exits 1 with documented stderr', async () => {
    const res = await runShim(['bogus', 'thing']);
    expect(res.code).toBe(1);
    expect(res.stderr).toContain("Error: test shim does not implement 'bogus thing'.");
  });

  it('mcp operations leave a valid JSON file after each write (atomicity smoke)', async () => {
    const env = { CONCIERGE_TEST_CLAUDE_JSON: claudeJson };
    const ops: Array<[string[], number]> = [
      [
        ['mcp', 'add', '--transport', 'stdio', 'a', '--scope', 'user', '--', 'node', '/a.js'],
        0,
      ],
      [
        ['mcp', 'add', '--transport', 'stdio', 'b', '--scope', 'user', '--', 'node', '/b.js', 'arg with spaces'],
        0,
      ],
      [['mcp', 'remove', 'a'], 0],
      [['mcp', 'list'], 0],
    ];
    for (const [args, expectedCode] of ops) {
      const res = await runShim(args, env);
      expect(res.code).toBe(expectedCode);
      // After every op, the file (if it exists) must parse cleanly.
      if (existsSync(claudeJson)) {
        const raw = readFileSync(claudeJson, 'utf8');
        expect(() => JSON.parse(raw)).not.toThrow();
      }
    }
    const finalDoc = JSON.parse(readFileSync(claudeJson, 'utf8'));
    expect(finalDoc.mcpServers.b.args).toEqual(['/b.js', 'arg with spaces']);
    expect(finalDoc.mcpServers.a).toBeUndefined();
  });

  it('mcp commands without $CONCIERGE_TEST_CLAUDE_JSON refuse and exit 2', async () => {
    // Spawn with env explicitly stripped.
    const cleanEnv: NodeJS.ProcessEnv = { ...process.env };
    delete cleanEnv['CONCIERGE_TEST_CLAUDE_JSON'];
    try {
      await execFileAsync(SHIM, ['mcp', 'list'], { env: cleanEnv, encoding: 'utf8' });
      throw new Error('expected non-zero exit');
    } catch (err) {
      const e = err as NodeJS.ErrnoException & { stderr?: string; code?: number };
      expect(e.code).toBe(2);
      expect(e.stderr).toContain('refusing to touch ~/.claude.json');
    }
  });
});
