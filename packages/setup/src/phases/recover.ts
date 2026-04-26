// C7: Recovery phase. Thin orchestration over C5's hardReinstallSequence +
// C6's verifyInstall. Implements the spec's "1 retry" semantics:
//
//   "1 retry" = ONE full hard-reinstall + ONE re-run of the verification
//   policy. NOT a sub-check retry. NOT multiple hard-reinstalls.
//
// Per spec §"Verification-failed path":
//   a. Print "Verification mismatch — running hard-reinstall recovery..."
//   b. Run hardReinstallSequence (osascript quit + rm + open Claude +
//      open .mcpb + CLI re-register).
//   c. Re-run verifyInstall.
//   d. If still failing: emit final failure modes per target. Caller (D1
//      orchestrator) translates into the diagnostic exit.
//
// Decision: even when hard-reinstall partially fails (e.g., osascript exits
// non-zero, open exits non-zero), we STILL run reverify. The spec's "1 retry"
// contract is "one full hard-reinstall + reverify" — reverify is part of the
// budget, not gated on hard-reinstall success. Reverify is the source of
// truth for whether recovery worked; the hard-reinstall outcome is
// informational. (A partially-failed reinstall might still leave Claude in
// a recoverable state — only verify can tell us.) This decision is captured
// in the test "Hard-reinstall itself fails".

import {
  hardReinstallSequence,
  type RegisterResult,
} from './claudeRegister.js';
import { verifyInstall, type VerifyResult } from './verify.js';
import type { EmbeddedManifest } from '../types/manifest.js';

export interface RecoverOptions {
  manifest: EmbeddedManifest;
  mcpbPath: string;
  unpackedDistIndexJsPath: string;
  homedir: string;
  targets: { desktop: boolean; cli: boolean };
  /** Optional progress callback for the UI module to render the recovery
   *  steps live (since this can take ~20s). */
  onProgress?: (line: string) => void;
  /** Override timeouts (test only) — passed through to verifyInstall. */
  spawnInitTimeoutMs?: number;
  spawnToolCallTimeoutMs?: number;
}

export interface RecoverResult {
  /** True iff verification PASSED after the single hard-reinstall attempt. */
  recovered: boolean;
  /** Result of the hard-reinstall sequence itself. */
  reinstall: RegisterResult;
  /** Result of the post-reinstall verification. */
  postVerify: VerifyResult;
  /** Set when recovered: false — names the specific final failure mode per target. */
  finalFailureMode?: {
    desktop?: string;
    cli?: string;
  };
}

/** Run the documented recovery sequence ONCE and re-verify.
 *  Per spec: "1 retry" = one full hard-reinstall + one verification re-run.
 *  No sub-check retries; no second hard-reinstall. */
export async function runRecovery(
  options: RecoverOptions,
): Promise<RecoverResult> {
  const emit = (line: string): void => {
    if (options.onProgress !== undefined) {
      options.onProgress(line);
    }
  };

  emit(
    'WARN Verification mismatch - running hard-reinstall recovery (1 attempt)...',
  );

  // ----- Step 1: hard-reinstall ------------------------------------------
  // hardReinstallSequence wraps the full 5-step sequence (osascript quit +
  // rm + open Claude + open .mcpb + CLI re-register) in C5. We do NOT
  // re-implement; we delegate. Per-step progress emission is best-effort
  // narrative (C5 doesn't expose per-step callbacks; emit summaries).
  let reinstall: RegisterResult;
  try {
    reinstall = await hardReinstallSequence({
      manifest: options.manifest,
      mcpbPath: options.mcpbPath,
      unpackedDistIndexJsPath: options.unpackedDistIndexJsPath,
      homedir: options.homedir,
    });
  } catch (err) {
    // Should not happen — hardReinstallSequence catches its own errors and
    // returns failure-shaped RegisterTargetResults. But guard against
    // unexpected throws (e.g., import failures in the C5 module).
    const message = err instanceof Error ? err.message : String(err);
    emit(`WARN Hard-reinstall threw unexpectedly: ${message}`);
    reinstall = {
      desktop: {
        target: 'desktop',
        status: 'failed',
        detail: `Unexpected throw: ${message}`,
      },
      cli: {
        target: 'cli',
        status: 'failed',
        detail: `Unexpected throw: ${message}`,
      },
    };
  }

  // Emit per-step summaries based on the RegisterResult outcomes. The
  // hard-reinstall is conceptually 5 steps but C5 returns per-target
  // outcomes; map those to user-visible progress lines.
  if (options.targets.desktop) {
    if (reinstall.desktop.status === 'registered') {
      emit('OK Quit Claude');
      emit('OK Removed extension dir');
      emit('OK Reopened Claude');
      emit('OK Reinstalled .mcpb');
    } else if (reinstall.desktop.status === 'skipped-target-missing') {
      emit('SKIP Claude Desktop not installed - skipped Desktop steps');
    } else {
      emit(
        `WARN Desktop hard-reinstall did not complete cleanly: ${reinstall.desktop.detail ?? ''}`,
      );
    }
  }
  if (options.targets.cli) {
    if (reinstall.cli.status === 'registered') {
      emit('OK CLI re-registered');
    } else if (reinstall.cli.status === 'skipped-target-missing') {
      emit('SKIP Claude CLI not installed - skipped CLI re-registration');
    } else {
      emit(
        `WARN CLI hard-reinstall did not complete cleanly: ${reinstall.cli.detail ?? ''}`,
      );
    }
  }

  // ----- Step 2: re-verify ------------------------------------------------
  // Per spec contract: even if hard-reinstall partially failed, reverify is
  // still part of the 1-retry budget. Verify is the source of truth.
  const verifyOpts: Parameters<typeof verifyInstall>[0] = {
    manifest: options.manifest,
    unpackedDistIndexJsPath: options.unpackedDistIndexJsPath,
    homedir: options.homedir,
    targets: options.targets,
  };
  if (options.spawnInitTimeoutMs !== undefined) {
    verifyOpts.spawnInitTimeoutMs = options.spawnInitTimeoutMs;
  }
  if (options.spawnToolCallTimeoutMs !== undefined) {
    verifyOpts.spawnToolCallTimeoutMs = options.spawnToolCallTimeoutMs;
  }

  const postVerify = await verifyInstall(verifyOpts);

  // ----- Aggregate --------------------------------------------------------
  const recovered = postVerify.allTargetsPassed;
  const result: RecoverResult = { recovered, reinstall, postVerify };

  if (recovered) {
    emit('OK Recovery succeeded.');
    return result;
  }

  emit('WARN Recovery did not resolve the issue.');

  // Build finalFailureMode from the postVerify per-target failures.
  const finalFailureMode: { desktop?: string; cli?: string } = {};
  if (
    postVerify.desktop !== undefined &&
    !postVerify.desktop.pass &&
    postVerify.desktop.failureMode !== undefined
  ) {
    finalFailureMode.desktop = postVerify.desktop.failureMode;
  }
  if (
    postVerify.cli !== undefined &&
    !postVerify.cli.pass &&
    postVerify.cli.failureMode !== undefined
  ) {
    finalFailureMode.cli = postVerify.cli.failureMode;
  }
  if (
    finalFailureMode.desktop !== undefined ||
    finalFailureMode.cli !== undefined
  ) {
    result.finalFailureMode = finalFailureMode;
  }

  // NB: NO LOOP. NO SECOND HARD-REINSTALL. The 1-retry contract is exactly
  // one attempt — caller (D1 orchestrator) translates `recovered: false`
  // into the diagnostic exit.
  return result;
}
