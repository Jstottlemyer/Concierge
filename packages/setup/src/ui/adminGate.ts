// D3: Admin gate screen — Workspace non-admin path.
//
// Renders the orchestrator-formatted body, the handout hint, and waits for
// the user to press Enter so the parent shell doesn't drop the tail before
// the user reads it. Resolves on stdin close as well so non-interactive
// hosts (CI) don't hang.

import { t } from './i18n.js';
import { readLine, type PromptDeps } from './prompt.js';

export interface AdminGateDeps extends PromptDeps {
  ascii: boolean;
}

export async function showAdminGate(
  deps: AdminGateDeps,
  body: string,
): Promise<void> {
  deps.stdout.write(t('admin.heading') + '\n');
  deps.stdout.write(body);
  if (!body.endsWith('\n')) deps.stdout.write('\n');
  deps.stdout.write('\n' + t('admin.handoffHint') + '\n');
  deps.stdout.write(t('admin.pressEnter') + ' ');
  await readLine(deps);
}
