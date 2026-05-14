import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { renderPublishReminder } from '../../src/ui/publishReminder.js';

// The 6 i18n keys feeding renderPublishReminder. AC#5 asserts that none
// of these key strings appear in the rendered output — i.e., every key
// resolved cleanly via t() and the renderer did not accidentally emit a
// literal key path (which is what t() returns when a key is missing).
const I18N_KEYS = [
  'publishReminder.personal.heading',
  'publishReminder.personal.urlLine',
  'publishReminder.personal.docLink',
  'publishReminder.workspace.heading',
  'publishReminder.workspace.externalBranch',
  'publishReminder.workspace.internalBranch',
];

describe('renderPublishReminder', () => {
  it('personal + unicode: renders publish-required block with arrow + URL + doc anchor', () => {
    const out = renderPublishReminder('personal', false);
    expect(out).toContain('→ Next step: publish your consent screen');
    expect(out).toContain('prevents weekly re-login');
    expect(out).toContain(
      'https://console.cloud.google.com/apis/credentials/consent',
    );
    expect(out).toContain(
      'docs/setup/quickstart.md#required-publish-your-consent-screen-one-click-prevents-weekly-re-auth',
    );
    expect(out).toContain('Publish app');
  });

  it('personal + ASCII: arrow falls back to `>` (single char, NOT `->`)', () => {
    const out = renderPublishReminder('personal', true);
    // Leading directional cue uses the ASCII fallback `>`.
    expect(out.startsWith('> ')).toBe(true);
    // No Unicode arrow.
    expect(out).not.toContain('→');
    // Codex finding ck-1a2b3c4d5e: the ASCII fallback is `>`, NOT `->`.
    // (We assert against `-> ` specifically because the doc-anchor in the
    // body contains literal `-` chars; we only care about the directional
    // cue.)
    expect(out).not.toContain('-> Next step');
  });

  it('workspace + unicode: renders both External + Internal branches in one block', () => {
    const out = renderPublishReminder('workspace', false);
    expect(out).toContain('→ Next step: publish your consent screen');
    expect(out).toContain('User type = External');
    // Internal-users disambiguator must be present and clearly labelled.
    expect(out).toContain("Internal users: you're done");
    expect(out).toContain('tokens are already long-lived');
  });

  it('workspace + ASCII: arrow falls back to `>`', () => {
    const out = renderPublishReminder('workspace', true);
    expect(out.startsWith('> ')).toBe(true);
    expect(out).not.toContain('→');
    // Both branches still readable in ASCII.
    expect(out).toContain('User type = External');
    expect(out).toContain("Internal users: you're done");
  });

  it('AC#5: rendered output never contains a literal i18n key path (no key fallback)', () => {
    for (const accountType of ['personal', 'workspace'] as const) {
      for (const ascii of [true, false]) {
        const out = renderPublishReminder(accountType, ascii);
        for (const key of I18N_KEYS) {
          expect(
            out.includes(key),
            `${accountType}/${ascii ? 'ascii' : 'unicode'}: ` +
              `i18n key '${key}' leaked into rendered output — t() failed to resolve`,
          ).toBe(false);
        }
      }
    }
  });

  it('AC#8: docs/setup/quickstart.md contains the literal heading we link to', () => {
    // Doc-anchor regression — fail loudly if the quickstart heading is
    // edited without updating the renderer constant. Resolves both the
    // doc-rot risk and the scope-discipline finding (spec AC#8).
    const here = dirname(fileURLToPath(import.meta.url));
    // tests/ui → tests → packages/setup → packages → AuthTools → docs/setup/...
    const quickstartPath = join(
      here,
      '..',
      '..',
      '..',
      '..',
      'docs',
      'setup',
      'quickstart.md',
    );
    const content = readFileSync(quickstartPath, 'utf8');
    // The link target in the renderer is the kebab-cased anchor form of
    // this heading — assert the heading text itself exists verbatim.
    expect(content).toContain(
      'Required: publish your consent screen (one click, prevents weekly re-auth)',
    );
  });
});
