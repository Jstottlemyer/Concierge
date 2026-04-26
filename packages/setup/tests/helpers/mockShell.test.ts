import { describe, expect, it } from 'vitest';

import { createMockShell } from './mockShell.js';

describe('createMockShell', () => {
  it('matches an enqueued response by command pattern (string substring)', async () => {
    const shell = createMockShell();
    shell.enqueue('gws', { stdout: 'ok\n', exitCode: 0 });
    const result = await shell.runner('gws', ['auth', 'status']);
    expect(result).toEqual({ stdout: 'ok\n', exitCode: 0 });
  });

  it('matches an enqueued response by RegExp pattern', async () => {
    const shell = createMockShell();
    shell.enqueue(/^brew install /, { stdout: '', exitCode: 0 });
    const result = await shell.runner('brew', ['install', 'gws']);
    expect(result.exitCode).toBe(0);
  });

  it('expectCommands asserts the recorded sequence in order', async () => {
    const shell = createMockShell();
    shell.enqueue('brew', { stdout: '', exitCode: 0 });
    shell.enqueue('brew', { stdout: '', exitCode: 0 });
    await shell.runner('brew', ['install', 'gws']);
    await shell.runner('brew', ['install', 'gcloud']);
    shell.expectCommands(['brew install gws', 'brew install gcloud']);
  });

  it('honors FIFO order when multiple responses share a pattern', async () => {
    const shell = createMockShell();
    shell.enqueue('gws', { stdout: 'first', exitCode: 0 });
    shell.enqueue('gws', { stdout: 'second', exitCode: 0 });
    const a = await shell.runner('gws', ['auth', 'status']);
    const b = await shell.runner('gws', ['auth', 'status']);
    expect(a.stdout).toBe('first');
    expect(b.stdout).toBe('second');
  });

  it('records env and cwd on each invocation', async () => {
    const shell = createMockShell();
    shell.enqueue('gws', { stdout: '', exitCode: 0 });
    await shell.runner('gws', ['auth', 'status'], {
      env: { HOME: '/tmp/h' },
      cwd: '/tmp/proj',
    });
    const inv = shell.invocations()[0];
    expect(inv?.env).toEqual({ HOME: '/tmp/h' });
    expect(inv?.cwd).toBe('/tmp/proj');
    expect(inv?.command).toBe('gws');
    expect(inv?.args).toEqual(['auth', 'status']);
  });

  it('rejects with an explanatory error when no response is queued', async () => {
    const shell = createMockShell();
    await expect(shell.runner('gws', ['auth', 'status'])).rejects.toThrow(
      'no mock response for: gws auth status',
    );
  });

  it('reset clears both queue and invocations', async () => {
    const shell = createMockShell();
    shell.enqueue('gws', { stdout: 'ok', exitCode: 0 });
    await shell.runner('gws', ['auth', 'status']);
    expect(shell.invocations()).toHaveLength(1);
    shell.reset();
    expect(shell.invocations()).toHaveLength(0);
    await expect(shell.runner('gws', ['auth', 'status'])).rejects.toThrow();
  });

  it('stderrStream lines are concatenated into stderr (v1 simplification)', async () => {
    const shell = createMockShell();
    shell.enqueue('gws', {
      exitCode: 1,
      stderrStream: ['port 8080 in use', 'retry with --port'],
    });
    const result = await shell.runner('gws', ['auth', 'login']);
    expect(result.stderr).toBe('port 8080 in use\nretry with --port');
    expect(result.exitCode).toBe(1);
  });
});
