// D3: Install progress lines — one screen function per phase ('starting' /
// 'done' / 'failed'). Orchestrator calls this once per tool per phase.

import { g } from './glyphs.js';
import { t } from './i18n.js';

export interface InstallProgressDeps {
  stdout: NodeJS.WritableStream;
  ascii: boolean;
}

export type InstallPhase = 'starting' | 'done' | 'failed';

export function renderInstallLine(
  tool: string,
  phase: InstallPhase,
  ascii: boolean,
  detail?: string,
): string {
  switch (phase) {
    case 'starting':
      return t('install.starting', { arrow: g('arrow', ascii), tool });
    case 'done':
      if (detail !== undefined && detail !== '') {
        return t('install.done', {
          check: g('check', ascii),
          tool,
          version: detail,
        });
      }
      return t('install.doneNoVersion', { check: g('check', ascii), tool });
    case 'failed': {
      const tail = detail !== undefined && detail !== '' ? `: ${detail}` : '';
      return t('install.failed', {
        cross: g('cross', ascii),
        tool,
        detail: tail,
      });
    }
  }
}

export function writeInstallProgress(
  deps: InstallProgressDeps,
  tool: string,
  phase: InstallPhase,
  detail?: string,
): void {
  deps.stdout.write(renderInstallLine(tool, phase, deps.ascii, detail) + '\n');
}
