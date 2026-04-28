// D3: Banner screen — top-of-run greeting.

import { t } from './i18n.js';

export interface BannerDeps {
  stdout: NodeJS.WritableStream;
  ascii: boolean;
}

/** Resolve the embedded setup version, falling back to a dev-mode label. */
function resolveVersion(): string {
  if (typeof __CONCIERGE_SETUP_VERSION__ !== 'undefined') {
    return __CONCIERGE_SETUP_VERSION__;
  }
  return '0.0.0-dev';
}

export function renderBanner(ascii: boolean): string {
  const _ = ascii; // ASCII flag reserved for future ornamentation; banner is plain text today.
  void _;
  const lines: string[] = [
    t('banner.title', { version: resolveVersion() }),
    t('banner.tagline'),
    '',
  ];
  return lines.join('\n');
}

export function writeBanner(deps: BannerDeps): void {
  deps.stdout.write(renderBanner(deps.ascii) + '\n');
}
