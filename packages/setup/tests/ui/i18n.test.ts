import { describe, expect, it } from 'vitest';

import { t } from '../../src/ui/i18n.js';

describe('i18n.t', () => {
  it('interpolates a single variable', () => {
    expect(t('banner.title', { version: '2.0.0' })).toBe(
      'Concierge Setup v2.0.0',
    );
  });

  it('returns a string with no interpolation when key has no vars', () => {
    expect(t('banner.tagline')).toBe(
      'Google Workspace write-access for Claude Desktop',
    );
  });

  it('interpolates numeric values via toString', () => {
    expect(t('lock.line1', { pid: 1234, startedAt: '2026-04-28 09:15:32' })).toBe(
      'Another concierge-setup is running (PID 1234, started 2026-04-28 09:15:32).',
    );
  });

  it('leaves unknown placeholders literal when var missing', () => {
    // Documenting the chosen behavior: missing var = visible bug, not throw.
    const out = t('banner.title');
    expect(out).toBe('Concierge Setup v{version}');
  });

  it('replaces ALL occurrences of the same var', () => {
    // success.targets uses {desktop} and {cli}; verify both swap.
    const out = t('success.targets', { desktop: 'OK', cli: 'X' });
    expect(out).toBe('   Claude Desktop: OK  Claude CLI: X');
  });
});
