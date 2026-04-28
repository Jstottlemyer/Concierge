// D3: Compose every screen into a single `UISink` implementation that
// satisfies the contract D1 ships in `packages/setup/src/orchestrator.ts`.
//
// Construction is dependency-injected so tests can drive the sink with
// `Buffer`-backed streams; D5 wires `process.stdout/stderr/stdin` for the
// real CLI.

import type { UISink } from '../orchestrator.js';

import { writeBanner } from './banner.js';
import { showAdminGate } from './adminGate.js';
import { showConsent } from './consent.js';
import { writeDiagnose } from './diagnose.js';
import { writeFailure } from './failure.js';
import { writeInstallProgress } from './installProgress.js';
import { writeLockCollision } from './lockCollision.js';
import {
  startOauthWait,
  type HeartbeatHandle,
} from './oauthWait.js';
import { writeProbeProgress } from './probeProgress.js';
import { writeSuccess } from './success.js';
import type { Locale } from './i18n.js';

export interface TerminalUIOptions {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  /** stdin used by interactive prompts (consent screen, OAuth wait, admin gate). */
  stdin: NodeJS.ReadableStream;
  /** ASCII mode — disables Unicode glyphs (check / cross / arrow) in favor
   *  of ASCII fallbacks (OK / X / >). D5 owns the auto-detect via
   *  `shouldUseUnicode()`; this flag is the resolved decision. */
  ascii: boolean;
  /** Locale for `t('key')` lookups. v2.0 ships English only; reserved for v2.1. */
  locale?: Locale;
}

export function createTerminalUI(options: TerminalUIOptions): UISink {
  const { stdout, stderr, stdin, ascii } = options;
  // Track the heartbeat so a follow-on call (success/failure/etc.) can
  // stop it implicitly. Single-slot is fine: orchestrator only ever has
  // one OAuth wait in flight at a time.
  let heartbeat: HeartbeatHandle | null = null;
  const stopHeartbeat = (): void => {
    if (heartbeat !== null) {
      heartbeat.stop();
      heartbeat = null;
    }
  };

  return {
    banner(): void {
      stopHeartbeat();
      writeBanner({ stdout, ascii });
    },

    showProbeProgress(probeName, status): void {
      stopHeartbeat();
      writeProbeProgress({ stdout, ascii }, probeName, status);
    },

    async showConsentScreen(text): Promise<{ accepted: boolean }> {
      stopHeartbeat();
      return showConsent({ stdin, stdout, ascii }, text);
    },

    showInstallProgress(toolName, phase, detail): void {
      stopHeartbeat();
      writeInstallProgress({ stdout, ascii }, toolName, phase, detail);
    },

    showOauthWait(authUrl): void {
      // Stop any previous one defensively (re-entry on retry paths).
      stopHeartbeat();
      heartbeat = startOauthWait({ stdout, ascii }, authUrl);
    },

    async showAdminGate(text): Promise<void> {
      stopHeartbeat();
      await showAdminGate({ stdin, stdout, ascii }, text);
    },

    showSuccess(text): void {
      stopHeartbeat();
      // The orchestrator's text is informational ("Concierge is set up." or
      // "Concierge is set up. (Recovery succeeded after one retry.)"). We
      // surface it as the success-screen `detail` line and assume both
      // targets passed by the time orchestrator calls success — failure
      // paths exit before this method.
      writeSuccess(
        { stdout, ascii },
        { detail: text, desktopOk: true, cliOk: true },
      );
    },

    showFailure(phase, message, copyableCommand): void {
      stopHeartbeat();
      writeFailure(
        { stderr, ascii },
        copyableCommand !== undefined
          ? { phase, message, copyableCommand }
          : { phase, message },
      );
    },

    showLockCollision(holderPid, holderStartedAt): void {
      stopHeartbeat();
      writeLockCollision({ stderr }, holderPid, holderStartedAt);
    },

    showDiagnose(text): void {
      stopHeartbeat();
      writeDiagnose({ stdout }, text);
    },
  };
}
