// buildToolContext unit tests — Wave 10.
//
// Light-touch: the builder is pure wiring, but we verify it composes the
// progress emitter correctly given (a) a progress token, (b) no progress token,
// (c) a token but no sendNotification.

import { describe, expect, it, vi } from 'vitest';

import {
  noopProgressEmitter,
} from '../../src/mcp/progress.js';
import { buildToolContext } from '../../src/mcp/tool-context.js';

describe('buildToolContext', () => {
  it('populates the ctx with an ISO-8601 `now` field by default', () => {
    const { ctx } = buildToolContext();
    expect(typeof ctx.now).toBe('string');
    // Parseable as a date.
    expect(Number.isNaN(Date.parse(ctx.now))).toBe(false);
  });

  it('honours a caller-provided `now` override for determinism', () => {
    const frozen = '2025-06-01T12:00:00.000Z';
    const { ctx } = buildToolContext({ now: frozen });
    expect(ctx.now).toBe(frozen);
  });

  it('exposes every expected capability field', () => {
    const { capabilities } = buildToolContext();
    expect(typeof capabilities.runGws).toBe('function');
    expect(typeof capabilities.loadState).toBe('function');
    expect(typeof capabilities.writeState).toBe('function');
    expect(typeof capabilities.ensureBundleGranted).toBe('function');
    expect(typeof capabilities.authInProgressProbe).toBe('function');
    expect(typeof capabilities.redact).toBe('function');
    expect(typeof capabilities.progress).toBe('function');
  });

  it('falls back to the noop progress emitter when no token is supplied', () => {
    const { capabilities } = buildToolContext({});
    expect(capabilities.progress).toBe(noopProgressEmitter);
  });

  it('falls back to the noop emitter when token supplied without sendNotification', () => {
    const { capabilities } = buildToolContext({ progressToken: 'tok-1' });
    expect(capabilities.progress).toBe(noopProgressEmitter);
  });

  it('wires a real emitter when both token and sendNotification are provided', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const { capabilities } = buildToolContext({
      progressToken: 'tok-abc',
      sendNotification: send,
    });
    await capabilities.progress('detecting_grant', { account: 'alice@example.com' });
    expect(send).toHaveBeenCalledTimes(1);
    const [method, params] = send.mock.calls[0] ?? [];
    expect(method).toBe('notifications/progress');
    expect(params).toMatchObject({ progressToken: 'tok-abc' });
  });

  it('redact capability scrubs OAuth tokens', () => {
    const { capabilities } = buildToolContext();
    const redacted = capabilities.redact({ token: 'ya29.LEAKEDVALUE' });
    expect(redacted).toEqual({ token: '[REDACTED]' });
  });
});
