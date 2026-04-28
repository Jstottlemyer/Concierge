// D3: OAuth wait screen.
//
// Prints the "Browser opened. Sign in…" line, then begins emitting a
// heartbeat dot every 5s on a separate line so the user sees the process
// is alive while waiting for the browser callback.
//
// The orchestrator calls `showOauthWait` and continues with subprocess
// work — when the subprocess returns, the next sink call (showSuccess /
// showFailure) implicitly ends the heartbeat. To make that work cleanly
// without coupling, we return a `stop()` handle the sink composer keeps
// alive in module scope and clears on the next non-OAuth call.

import { g } from './glyphs.js';
import { t } from './i18n.js';

export interface OauthWaitDeps {
  stdout: NodeJS.WritableStream;
  ascii: boolean;
}

export interface HeartbeatHandle {
  stop: () => void;
}

const HEARTBEAT_MS = 5000;

export function startOauthWait(
  deps: OauthWaitDeps,
  authUrl: string | undefined,
): HeartbeatHandle {
  deps.stdout.write(t('oauth.opening') + '...\n');
  if (authUrl !== undefined && authUrl !== '') {
    deps.stdout.write(t('oauth.url', { url: authUrl }) + '\n');
  }
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    deps.stdout.write(g('dot', deps.ascii));
  }, HEARTBEAT_MS);
  // Don't keep the event loop alive just for the heartbeat — orchestrator
  // owns the lifecycle, and the timer should not block process exit on
  // signal-driven termination.
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  return {
    stop: (): void => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      // Flush a newline so the next screen starts on a fresh line.
      deps.stdout.write('\n');
    },
  };
}
