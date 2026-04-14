// T8: renderStageMessage() interpolation tests.
//
// Covers:
//   - happy-path interpolation for every stage
//   - missing-context fallback (no `{bundle_display}` literal leaks)
//   - unknown placeholder tokens pass through verbatim (defensive)
//   - stages without placeholders render their literal template

import { describe, expect, it } from 'vitest';

import { renderStageMessage } from '../../src/mcp/progress-messages.js';

describe('renderStageMessage — happy path', () => {
  it('interpolates {account} for detecting_grant', () => {
    expect(renderStageMessage('detecting_grant', { account: 'alice@example.com' })).toBe(
      'Checking Google access for alice@example.com…',
    );
  });

  it('interpolates {bundle_display} and {scope_count} for launching_browser', () => {
    expect(
      renderStageMessage('launching_browser', {
        account: 'alice@example.com',
        bundleDisplay: 'Productivity',
        scopeCount: 8,
      }),
    ).toBe('Opening browser for Google consent (Productivity bundle, 8 scopes).');
  });

  it('renders awaiting_consent without any interpolation', () => {
    expect(renderStageMessage('awaiting_consent', {})).toBe(
      'Waiting for you to approve in the browser…',
    );
  });

  it('renders persisting_token without any interpolation', () => {
    expect(renderStageMessage('persisting_token', {})).toBe(
      'Consent received — saving credentials to Keychain.',
    );
  });

  it('interpolates {tool} for retrying_call', () => {
    expect(
      renderStageMessage('retrying_call', { account: 'alice@example.com', tool: 'gmail_send' }),
    ).toBe('Done. Retrying gmail_send…');
  });

  it('renders failed_consent_denied with the canonical refusal copy', () => {
    expect(renderStageMessage('failed_consent_denied', {})).toBe(
      'Consent was denied or the window was closed. Nothing was changed.',
    );
  });

  it('handles scopeCount = 0 without treating it as undefined', () => {
    // Edge: `scopeCount` is a number; falsy 0 must render as "0", not fallback.
    expect(
      renderStageMessage('launching_browser', {
        bundleDisplay: 'Productivity',
        scopeCount: 0,
      }),
    ).toBe('Opening browser for Google consent (Productivity bundle, 0 scopes).');
  });
});

describe('renderStageMessage — missing context fallbacks', () => {
  it('substitutes "your account" when account is absent', () => {
    expect(renderStageMessage('detecting_grant', {})).toBe(
      'Checking Google access for your account…',
    );
  });

  it('does not leak `{bundle_display}` literal when bundleDisplay is undefined', () => {
    const out = renderStageMessage('launching_browser', { scopeCount: 4 });
    expect(out).not.toContain('{bundle_display}');
    expect(out).toContain('the required bundle');
  });

  it('does not leak `{scope_count}` literal when scopeCount is undefined', () => {
    const out = renderStageMessage('launching_browser', { bundleDisplay: 'Productivity' });
    expect(out).not.toContain('{scope_count}');
    expect(out).toBe('Opening browser for Google consent (Productivity bundle, the required scopes).');
  });

  it('does not leak `{tool}` literal when tool is undefined', () => {
    const out = renderStageMessage('retrying_call', {});
    expect(out).not.toContain('{tool}');
    expect(out).toBe('Done. Retrying the tool…');
  });

  it('renders a fully-empty context without any leaked placeholders', () => {
    // None of the 6 stages should ever emit a `{placeholder}` literal,
    // even when the caller has zero context to supply.
    const stages = [
      'detecting_grant',
      'launching_browser',
      'awaiting_consent',
      'persisting_token',
      'retrying_call',
      'failed_consent_denied',
    ] as const;
    for (const stage of stages) {
      const msg = renderStageMessage(stage, {});
      expect(msg).not.toMatch(/\{[a-z_]+\}/);
      expect(msg.length).toBeGreaterThan(0);
    }
  });
});
