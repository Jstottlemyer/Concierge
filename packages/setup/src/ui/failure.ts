// D3: Failure screen — `! <phase> failed: <message>` with optional copyable
// command + log path.

import { g } from './glyphs.js';
import { t } from './i18n.js';

export interface FailureDeps {
  stderr: NodeJS.WritableStream;
  ascii: boolean;
}

export interface FailureFacts {
  phase: string;
  message: string;
  copyableCommand?: string;
  logPath?: string;
}

export function renderFailure(facts: FailureFacts, ascii: boolean): string {
  const lines: string[] = [
    t('failure.heading', {
      warn: g('warn', ascii),
      phase: facts.phase,
      message: facts.message,
    }),
  ];
  if (facts.copyableCommand !== undefined && facts.copyableCommand !== '') {
    lines.push(t('failure.copyable', { command: facts.copyableCommand }));
  }
  if (facts.logPath !== undefined && facts.logPath !== '') {
    lines.push(t('failure.logHint', { logPath: facts.logPath }));
  }
  return lines.join('\n');
}

export function writeFailure(deps: FailureDeps, facts: FailureFacts): void {
  deps.stderr.write(renderFailure(facts, deps.ascii) + '\n');
}
