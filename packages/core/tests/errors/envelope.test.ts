// T5: error-envelope helper tests.
//
// Covers Decision #4 (single-shape `ErrorEnvelope` + `makeError()` as the
// only construction point) and the dev-mode validation guard that catches
// schema drift during development.

import { describe, it, expect } from 'vitest';

import {
  ErrorEnvelopeSchema,
  makeError,
  type ErrorEnvelope,
} from '../../src/errors/envelope.js';

describe('makeError', () => {
  it('builds a minimal envelope with just error_code + message', () => {
    const env = makeError({
      error_code: 'validation_error',
      message: 'bad input',
    });

    expect(env.ok).toBe(false);
    expect(env.error_code).toBe('validation_error');
    expect(env.message).toBe('bad input');

    // Optional fields must be absent (not `undefined` keys) so
    // `exactOptionalPropertyTypes` consumers see clean wire output.
    expect(Object.prototype.hasOwnProperty.call(env, 'gws_version')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(env, 'next_call')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(env, 'retry_after_ms')).toBe(false);
  });

  it('passes through all optional fields when provided', () => {
    const env = makeError({
      error_code: 'gws_error',
      message: 'subprocess failed',
      gws_version: '0.1.2',
      gws_stderr: 'boom',
      gws_exit_code: 2,
      retry_after_ms: 0,
      next_call: { tool: 'gmail_send', arguments: { to: 'a@b.com' } },
      copyable_command: 'gws auth setup',
      docs_url: 'https://example.com/docs',
    });

    expect(env.gws_version).toBe('0.1.2');
    expect(env.gws_stderr).toBe('boom');
    expect(env.gws_exit_code).toBe(2);
    expect(env.retry_after_ms).toBe(0);
    expect(env.next_call).toEqual({ tool: 'gmail_send', arguments: { to: 'a@b.com' } });
    expect(env.copyable_command).toBe('gws auth setup');
    expect(env.docs_url).toBe('https://example.com/docs');
  });

  it('carries confirmation_phrase on confirmation_required envelopes', () => {
    const env = makeError({
      error_code: 'confirmation_required',
      message: 'This will delete alice@example.com permanently.',
      confirmation_phrase: 'remove alice@example.com',
      next_call: {
        tool: 'remove_account',
        arguments: { email: 'alice@example.com', confirm: 'remove alice@example.com' },
      },
    });

    expect(env.error_code).toBe('confirmation_required');
    expect(env.confirmation_phrase).toBe('remove alice@example.com');
    expect(env.next_call?.arguments['confirm']).toBe('remove alice@example.com');
  });

  it('rejects empty message in dev mode', () => {
    expect(() => makeError({ error_code: 'validation_error', message: '' })).toThrow(
      /message.*non-empty/i,
    );
    expect(() => makeError({ error_code: 'validation_error', message: '   ' })).toThrow(
      /message.*non-empty/i,
    );
  });

  it('rejects unknown error_code in dev mode', () => {
    expect(() =>
      makeError({
        // Force an invalid code through the type system to simulate a drift bug.
        error_code: 'not_a_real_code' as unknown as ErrorEnvelope['error_code'],
        message: 'oops',
      }),
    ).toThrow(/unknown error_code/i);
  });

  it('produces output that matches the outbound Zod schema (MCP wire shape)', () => {
    const env = makeError({
      error_code: 'auth_setup_needed',
      message: 'Run `gws auth setup` to sign in.',
      copyable_command: 'gws auth setup',
    });

    const parsed = ErrorEnvelopeSchema.safeParse(env);
    expect(parsed.success).toBe(true);
  });

  it('round-trips through JSON without losing fields', () => {
    const env = makeError({
      error_code: 'network_error',
      message: 'timeout',
      retry_after_ms: 1500,
    });

    const roundTripped = JSON.parse(JSON.stringify(env)) as unknown;
    const parsed = ErrorEnvelopeSchema.safeParse(roundTripped);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.retry_after_ms).toBe(1500);
      expect(parsed.data.error_code).toBe('network_error');
      expect(parsed.data.ok).toBe(false);
    }
  });
});
