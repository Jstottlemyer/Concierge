// T8: createProgressEmitter + noopProgressEmitter behavior.
//
// Covers:
//   - emitter calls send() with the correct notifications/progress shape
//   - `progressToken` is preserved as supplied (string OR number)
//   - `message` matches renderStageMessage for the stage + context
//   - noopProgressEmitter resolves silently without calling anything
//   - absent progressToken => emitter is a noop (no send calls)
//   - send() errors propagate (best-effort emit, but surface transport failure)

import { describe, expect, it, vi } from 'vitest';

import {
  createProgressEmitter,
  noopProgressEmitter,
  type ProgressStage,
} from '../../src/mcp/progress.js';
import { renderStageMessage } from '../../src/mcp/progress-messages.js';
import { PROGRESS_VALUES } from '../../src/mcp/progress-values.js';

describe('createProgressEmitter', () => {
  it('sends a notifications/progress with the correct shape', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const emit = createProgressEmitter({ progressToken: 'tok-123', send });

    await emit('launching_browser', {
      account: 'alice@example.com',
      bundleDisplay: 'Productivity',
      scopeCount: 8,
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('notifications/progress', {
      progressToken: 'tok-123',
      progress: PROGRESS_VALUES.launching_browser.progress,
      total: PROGRESS_VALUES.launching_browser.total,
      message: renderStageMessage('launching_browser', {
        account: 'alice@example.com',
        bundleDisplay: 'Productivity',
        scopeCount: 8,
      }),
    });
  });

  it('preserves a numeric progressToken', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const emit = createProgressEmitter({ progressToken: 42, send });

    await emit('detecting_grant', { account: 'alice@example.com' });

    expect(send).toHaveBeenCalledTimes(1);
    const [, params] = send.mock.calls[0] ?? [];
    expect(params).toMatchObject({ progressToken: 42 });
  });

  it('emits the full 5-stage happy-path sequence in order', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const emit = createProgressEmitter({ progressToken: 'tok-1', send });

    const stages: ProgressStage[] = [
      'detecting_grant',
      'launching_browser',
      'awaiting_consent',
      'persisting_token',
      'retrying_call',
    ];
    for (const stage of stages) {
      await emit(stage, {
        account: 'alice@example.com',
        bundleDisplay: 'Productivity',
        scopeCount: 8,
        tool: 'drive_list',
      });
    }

    expect(send).toHaveBeenCalledTimes(5);
    const observedProgress = send.mock.calls.map((call) => {
      const params = call[1] as { progress: number };
      return params.progress;
    });
    // Sequence must be strictly monotonically increasing.
    for (let i = 1; i < observedProgress.length; i += 1) {
      const prev = observedProgress[i - 1];
      const curr = observedProgress[i];
      expect(prev).toBeDefined();
      expect(curr).toBeDefined();
      if (prev !== undefined && curr !== undefined) {
        expect(curr).toBeGreaterThan(prev);
      }
    }
  });

  it('propagates errors from send()', async () => {
    const send = vi.fn().mockRejectedValue(new Error('transport dead'));
    const emit = createProgressEmitter({ progressToken: 'tok-1', send });

    await expect(emit('detecting_grant', { account: 'alice@example.com' })).rejects.toThrow(
      'transport dead',
    );
  });

  it('becomes a noop when progressToken is undefined (client did not opt in)', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const emit = createProgressEmitter({ send });

    await emit('detecting_grant', { account: 'alice@example.com' });
    await emit('launching_browser', { account: 'alice@example.com', bundleDisplay: 'Productivity', scopeCount: 8 });

    expect(send).not.toHaveBeenCalled();
  });
});

describe('noopProgressEmitter', () => {
  it('resolves silently without side effects', async () => {
    await expect(noopProgressEmitter('detecting_grant', {})).resolves.toBeUndefined();
    await expect(
      noopProgressEmitter('failed_consent_denied', { account: 'alice@example.com' }),
    ).resolves.toBeUndefined();
  });

  it('accepts every ProgressStage without throwing', async () => {
    const stages: ProgressStage[] = [
      'detecting_grant',
      'launching_browser',
      'awaiting_consent',
      'persisting_token',
      'retrying_call',
      'failed_consent_denied',
    ];
    for (const stage of stages) {
      await expect(noopProgressEmitter(stage, {})).resolves.toBeUndefined();
    }
  });
});
