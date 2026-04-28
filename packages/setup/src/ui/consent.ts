// D3: Consent screen — prints the orchestrator-rendered text block, then
// prompts `Continue? [Y/n]`.
//
// Acceptance rules (case-insensitive):
//   y / yes / empty-line  → accepted
//   anything else         → rejected
//
// Empty-line accepts to match the `[Y/n]` (capital Y = default) convention.

import { t } from './i18n.js';
import { readLine, type PromptDeps } from './prompt.js';

export interface ConsentDeps extends PromptDeps {
  ascii: boolean;
}

/** Pure parser used by tests + the prompt loop. */
export function parseConsentInput(raw: string): { accepted: boolean } {
  const norm = raw.trim().toLowerCase();
  if (norm === '' || norm === 'y' || norm === 'yes') return { accepted: true };
  return { accepted: false };
}

export async function showConsent(
  deps: ConsentDeps,
  body: string,
): Promise<{ accepted: boolean }> {
  // Body comes pre-formatted from the orchestrator (renderConsentText).
  deps.stdout.write(body);
  if (!body.endsWith('\n')) deps.stdout.write('\n');
  deps.stdout.write('\n' + t('consent.willInstallSummary') + '\n');
  deps.stdout.write(t('consent.prompt') + ' ');
  const line = await readLine(deps);
  const decision = parseConsentInput(line);
  if (!decision.accepted) {
    deps.stdout.write(t('consent.declined') + '\n');
  }
  return decision;
}
