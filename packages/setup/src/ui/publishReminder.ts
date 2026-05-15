// Publish-consent reminder block. Printed at two moments per happy run:
//   1. Right after `runGwsAuthLogin()` succeeds — action-adjacent (user's
//      browser is still on the OAuth completion page, one tab-switch from
//      Cloud Console).
//   2. As the last block of the final success screen — survives terminal
//      scroll if the user scrolled past the post-OAuth print.
//
// Two branches keyed on AccountType:
//   - `personal` Gmail — must publish to escape the 7-day Testing-mode token
//     expiry. The reminder is mandatory action.
//   - `workspace` — publish if the consent screen was created as User type
//     = External; no-op if Internal (already long-lived). The orchestrator
//     can't tell which user-type was picked without a runtime probe of
//     Google's APIs (rejected as scope-creep in /spec Q1), so the message
//     covers both cases.
//
// URL + docs anchor are intentionally renderer constants — they must NOT
// be in the i18n table because a future locale translator (v2.1+) must
// never "translate" a Google Cloud Console URL or a docs-repo anchor path.

import type { AccountType } from '../phases/oauth.js';
import { g } from './glyphs.js';
import { t } from './i18n.js';

/** Google Cloud Console consent-screen URL — single per project, no
 *  project_id substitution. Static; safe to hardcode. */
const PUBLISH_URL =
  'https://console.cloud.google.com/apis/credentials/consent';

/** Anchor into the prose recipe at docs/setup/quickstart.md. Verified by
 *  the regression case in publishReminder.test.ts that reads the file
 *  and asserts the literal heading exists (per spec AC#8). */
const DOC_ANCHOR =
  'docs/setup/quickstart.md#required-publish-your-consent-screen-one-click-prevents-weekly-re-auth';

/** Render the publish-consent reminder block for the given account type.
 *
 *  Pure function — no I/O, no trailing newline. Caller is responsible for
 *  flushing to its sink and for inserting any leading/trailing blank lines
 *  (the default sink does this).
 *
 *  Both branches consume `g('arrow', ascii)` for the leading directional
 *  cue AND for the inline "URL → Publish app" breadcrumb, so a single
 *  glyph swap covers both. */
export function renderPublishReminder(
  accountType: AccountType,
  ascii: boolean,
): string {
  const arrow = g('arrow', ascii);

  if (accountType === 'personal') {
    return [
      t('publishReminder.personal.heading', { arrow }),
      t('publishReminder.personal.urlLine', { url: PUBLISH_URL, arrow }),
      t('publishReminder.personal.docLink', { anchor: DOC_ANCHOR }),
    ].join('\n');
  }
  // accountType === 'workspace' — branch covers both External (publish) and
  // Internal (already done) without runtime probing.
  return [
    t('publishReminder.workspace.heading', { arrow }),
    t('publishReminder.workspace.externalBranch', { url: PUBLISH_URL, arrow }),
    t('publishReminder.workspace.internalBranch'),
  ].join('\n');
}
