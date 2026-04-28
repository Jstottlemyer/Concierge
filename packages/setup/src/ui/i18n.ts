// D3: Localization wrapper. v2.0 ships English-only; the seam exists so
// v2.1 can swap locale tables without touching every screen file.
//
// Usage:  t('banner.title', { version: '2.0.0' })
// Vars:   `{name}` placeholders. Missing vars are left literal — surfaces
//         a visible bug rather than throwing in the middle of a render.

const MESSAGES = {
  en: {
    'banner.title': 'Concierge Setup v{version}',
    'banner.tagline': 'Google Workspace write-access for Claude Desktop',

    'probe.scanningHeader': 'Scanning your machine...',
    'probe.detectedPrefix': 'Detected:',
    'probe.priorHeader': 'Found from previous Concierge install:',
    'probe.priorNone': '  - none',

    'consent.willInstallSummary':
      'Will install: gws CLI, gcloud CLI, Claude CLI, Claude Desktop (~250MB, 3-5 min)',
    'consent.prompt': 'Continue? [Y/n]',
    'consent.declined': 'Setup cancelled.',

    'install.starting': '{arrow} Installing {tool} via brew...',
    'install.done': '{check} {tool} {version} installed',
    'install.doneNoVersion': '{check} {tool} installed',
    'install.failed': '{cross} {tool} install failed{detail}',
    'install.skipped': '{recycle} {tool} already installed{version}',

    'oauth.opening':
      'Browser opened. Sign in, accept scopes, return here. Waiting',
    'oauth.url': 'If the browser did not open, visit: {url}',

    'success.heading': '{check} Concierge installed and verified.',
    'success.buildId': '   build_id: {buildId}',
    'success.targets': '   Claude Desktop: {desktop}  Claude CLI: {cli}',
    'success.try':
      '   Try `Use list_accounts` in Claude Desktop, or `claude` in your terminal.',
    'success.detail': '   {detail}',

    'failure.heading': '{warn} {phase} failed: {message}',
    'failure.copyable': '   Try: {command}',
    'failure.logHint': '   Log: {logPath}',

    'admin.heading': 'Admin action required',
    'admin.handoffHint':
      'Forward this file to your IT admin; re-run setup once they have completed it.',
    'admin.filePath': '   File: {path}',
    'admin.pressEnter': 'Press Enter to exit.',

    'lock.line1':
      'Another concierge-setup is running (PID {pid}, started {startedAt}).',
    'lock.line2': 'Wait for it to finish or kill it.',

    'probeLine.detected': 'Detected: {entries}',
    'probeLine.entry': '{name} {glyph}',
  },
} as const;

export type Locale = 'en';
export type MessageKey = keyof (typeof MESSAGES)['en'];

/** Lookup + interpolate a message. Missing vars stay literal as `{name}`. */
export function t(
  key: MessageKey,
  vars: Record<string, string | number> = {},
  locale: Locale = 'en',
): string {
  let s: string = MESSAGES[locale][key];
  for (const [k, v] of Object.entries(vars)) {
    s = s.split(`{${k}}`).join(String(v));
  }
  return s;
}
