// D3: Success screen — final block printed at the end of a happy run.

import type { AccountType } from '../phases/oauth.js';

import { g } from './glyphs.js';
import { t } from './i18n.js';
import { renderPublishReminder } from './publishReminder.js';

export interface SuccessDeps {
  stdout: NodeJS.WritableStream;
  ascii: boolean;
}

export interface SuccessFacts {
  /** Optional extra detail line from the orchestrator (e.g. "recovered after one retry"). */
  detail?: string;
  desktopOk: boolean;
  cliOk: boolean;
  /** Account type — threads through to the publish-consent reminder
   *  appended as the trailing block of `renderSuccess`. Required (no
   *  default fallback) per spec. */
  accountType: AccountType;
}

/** Resolve build_id with a dev-mode fallback. */
function resolveBuildId(): string {
  if (typeof __CONCIERGE_BUILD_ID__ !== 'undefined') {
    return __CONCIERGE_BUILD_ID__;
  }
  return 'dev';
}

export function renderSuccess(facts: SuccessFacts, ascii: boolean): string {
  const check = g('check', ascii);
  const cross = g('cross', ascii);
  const desktopGlyph = facts.desktopOk ? check : cross;
  const cliGlyph = facts.cliOk ? check : cross;
  const lines: string[] = [
    t('success.heading', { check }),
    t('success.buildId', { buildId: resolveBuildId() }),
    t('success.targets', { desktop: desktopGlyph, cli: cliGlyph }),
    t('success.try'),
  ];
  if (facts.detail !== undefined && facts.detail !== '') {
    lines.push(t('success.detail', { detail: facts.detail }));
  }
  // Publish-consent reminder is the trailing block of the success screen
  // so it survives terminal scroll if the user scrolled past the
  // post-OAuth print. Blank line separates it from the success-screen
  // body above.
  lines.push('');
  lines.push(renderPublishReminder(facts.accountType, ascii));
  return lines.join('\n');
}

export function writeSuccess(
  deps: SuccessDeps,
  facts: SuccessFacts,
): void {
  deps.stdout.write(renderSuccess(facts, deps.ascii) + '\n');
}
