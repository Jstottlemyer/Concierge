// D3: Lock collision screen (N3) — another concierge-setup is already running.

import { t } from './i18n.js';

export interface LockCollisionDeps {
  stderr: NodeJS.WritableStream;
}

export function renderLockCollision(
  pid: number,
  startedAt: string,
): string {
  return [
    t('lock.line1', { pid, startedAt }),
    t('lock.line2'),
  ].join('\n');
}

export function writeLockCollision(
  deps: LockCollisionDeps,
  pid: number,
  startedAt: string,
): void {
  deps.stderr.write(renderLockCollision(pid, startedAt) + '\n');
}
