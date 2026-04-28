// D1: Top-level orchestrator. Composes the C-phase modules into the
// `concierge-setup` user-facing pipeline. Owns lockfile + log file lifecycle
// and dispatches phase-by-phase with friendly per-phase error handling.
//
// The orchestrator is purely composition. Every meaningful step lives in a
// `phases/` module that this file calls in order. The only state owned here
// is the lock handle and the logger handle — both registered against
// `process.on('exit'|'SIGINT')` so signal-driven termination still cleans
// up on the way out.
//
// UISink (defined in this file, NOT imported from `ui/`): a sink contract
// that D3's `ui/index.ts` will satisfy. We invert the dependency this way to
// avoid a D1↔D3 cycle — tests inject a recording stub, production wires the
// real screens.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { redactStringForLog } from '@concierge/core/log';

import { acquireLock } from './lock.js';
import { openLogger, type SetupLogger } from './log.js';
import { runAllProbes, type ProbeContext } from './phases/probe.js';
import {
  buildConsentScreen,
  captureConsent,
  type ConsentScreen,
} from './phases/consent.js';
import {
  planInstallSteps,
  runInstallSteps,
  type InstallResult,
} from './phases/install.js';
import {
  runGwsAuthSetup,
  runGwsAuthLogin,
  classifyAccountDomain,
} from './phases/oauth.js';
import { registerClaude } from './phases/claudeRegister.js';
import { verifyInstall } from './phases/verify.js';
import { runRecovery } from './phases/recover.js';
import { checkForUpdate } from './phases/updateCheck.js';
import { readEmbeddedManifest } from './state/manifest.js';
import type { EmbeddedManifest } from './types/manifest.js';
import type {
  AccountDomainDetail,
  ClientSecretDetail,
  ProbeName,
  ProbeResult,
  ProbeStatus,
} from './types/probe.js';

// ---------------------------------------------------------------------------
// UISink — public contract for D3
// ---------------------------------------------------------------------------

export interface UISink {
  banner(): void;
  showProbeProgress(
    probeName: string,
    status: 'pending' | 'ok' | 'missing' | 'broken',
  ): void;
  showConsentScreen(text: string): Promise<{ accepted: boolean }>;
  showInstallProgress(
    toolName: string,
    phase: 'starting' | 'done' | 'failed',
    detail?: string,
  ): void;
  showOauthWait(authUrl?: string): void;
  showAdminGate(text: string): Promise<void>;
  showSuccess(text: string): void;
  showFailure(
    phase: string,
    message: string,
    copyableCommand?: string,
  ): void;
  showLockCollision(holderPid: number, holderStartedAt: string): void;
  showDiagnose(text: string): void;
}

// ---------------------------------------------------------------------------
// Public option/result types
// ---------------------------------------------------------------------------

export interface OrchestratorOptions {
  homedir: string;
  /** Absolute path to the embedded `.mcpb`'s unpacked `dist/index.js`. The
   *  setup bash bootstrap (E1) extracts the tarball into a `mktemp -d` before
   *  exec'ing us, so this path is owned by the orchestrator's caller. */
  unpackedDistIndexJsPath: string;
  /** UI sink — dependency-injected so D3 can wire its real screens here
   *  without this file importing from the ui/ module (D1↔D3 cycle). */
  ui: UISink;
  /** Optional override for the assets dir holding manifest.json. Defaults
   *  to the package-local `assets/` resolved from import.meta.url. */
  assetsDir?: string;
  /** Skip update check (used by tests + --diagnose). */
  skipUpdateCheck?: boolean;
  /** Lockfile absolute path. Defaults to `<homedir>/.config/concierge/setup.lock`. */
  lockfilePath?: string;
  /** Logs dir absolute path. Defaults to `<homedir>/.config/concierge/setup-logs`. */
  logsDir?: string;
  /** Optional override of the bundled `.mcpb` absolute path. Defaults to
   *  `<assetsDir>/<manifest.bundledMcpb.filename>`. */
  mcpbPath?: string;
}

export type OrchestratorOutcome =
  | 'success'
  | 'failure'
  | 'lock_collision'
  | 'admin_gate'
  | 'recovered_after_retry';

export interface OrchestratorResult {
  outcome: OrchestratorOutcome;
  /** 0 success, 1 lock_collision, 2 admin_gate, 3 failure. recovered_after_retry → 0. */
  exitCode: number;
  logPath?: string;
  failedPhase?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Map ProbeStatus → the narrowed UI status set. */
function uiProbeStatus(
  s: ProbeStatus,
): 'pending' | 'ok' | 'missing' | 'broken' {
  switch (s) {
    case 'ok':
      return 'ok';
    case 'missing':
      return 'missing';
    case 'broken':
      return 'broken';
    case 'stale':
      // No 'stale' bucket in the UI contract; surface as broken so the user
      // sees the warning treatment. (Stale items still drive the install
      // phase; this is purely the per-probe progress glyph.)
      return 'broken';
    case 'skipped':
      return 'pending';
  }
}

function probeByName(
  probes: readonly ProbeResult[],
  name: ProbeName,
): ProbeResult | undefined {
  return probes.find((p) => p.name === name);
}

/** Resolve the `targets` shape used by verify/recover from probe results. */
function resolveTargets(
  probes: readonly ProbeResult[],
): { desktop: boolean; cli: boolean } {
  const desktop = probeByName(probes, 'claude.desktop');
  const cli = probeByName(probes, 'claude.cli');
  return {
    // A target counts as "present" when its probe says `ok`.
    desktop: desktop?.status === 'ok',
    cli: cli?.status === 'ok',
  };
}

/** Default assets dir resolution from this module's URL. tsup flattens `dist/`,
 *  so we try a few candidate parents before giving up. */
function defaultAssetsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/orchestrator.ts → ../assets ; dist/index.js → ../assets ; both work.
  return join(here, '..', 'assets');
}

/** Friendly redaction wrapper for arbitrary error messages bound for the log. */
function safeMsg(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return redactStringForLog(raw);
}

/** Render a consent screen as the text block we hand the UI sink. */
function renderConsentText(screen: ConsentScreen): string {
  const lines: string[] = [];
  if (screen.detected.length > 0) {
    lines.push('Detected:');
    for (const d of screen.detected) lines.push(`  - ${d}`);
  }
  if (screen.priorInstall.length > 0) {
    lines.push('Prior install state:');
    for (const d of screen.priorInstall) lines.push(`  - ${d}`);
  }
  if (screen.willInstall.length > 0) {
    lines.push('Will install:');
    for (const d of screen.willInstall) lines.push(`  - ${d}`);
  }
  if (screen.willUpgrade.length > 0) {
    lines.push('Will upgrade:');
    for (const d of screen.willUpgrade) lines.push(`  - ${d}`);
  }
  if (screen.willInstall.length > 0 || screen.willUpgrade.length > 0) {
    lines.push(
      `Estimated download: ${String(screen.totalSizeMb)} MB (${screen.estimatedMinutes})`,
    );
  }
  return lines.join('\n');
}

/** Render the admin-gate block for a `pause-with-fix` consent migration. */
function renderAdminGateText(fixHint: string, screen: ConsentScreen): string {
  const consentText = renderConsentText(screen);
  return [consentText, '', 'Action required:', fixHint].join('\n').trim();
}

/** Lookup gws.clientSecret status — drives the "do we need gws auth setup?". */
function clientSecretMissing(probes: readonly ProbeResult[]): boolean {
  const cs = probeByName(probes, 'gws.clientSecret');
  return cs === undefined || cs.status === 'missing' || cs.status === 'broken';
}

/** Best-effort account type from probe results (defaults to `workspace`). */
function deriveExpectedAccountType(
  probes: readonly ProbeResult[],
): 'personal' | 'workspace' {
  const ad = probeByName(probes, 'account.domain') as
    | ProbeResult<AccountDomainDetail>
    | undefined;
  if (ad?.status === 'ok' && ad.detail !== undefined) return ad.detail.type;
  return 'workspace';
}

/** Pull a candidate suggested project_id for `gws auth setup`. */
function suggestedProjectId(probes: readonly ProbeResult[]): string {
  const cs = probeByName(probes, 'gws.clientSecret') as
    | ProbeResult<ClientSecretDetail>
    | undefined;
  return cs?.detail?.projectId ?? '';
}

/** Default service set we request when running `gws auth login`. Mirrors the
 *  productivity bundle the v1 persona uses; future per-vendor flows can pass
 *  a richer set when we expose orchestrator options for it. */
const DEFAULT_OAUTH_SERVICES: readonly string[] = [
  'gmail',
  'drive',
  'docs',
  'sheets',
  'calendar',
  'forms',
];

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

interface ExitArtifacts {
  releaseLock: () => Promise<void>;
  logger: SetupLogger | null;
  installedExitHandler: boolean;
  installedSigintHandler: boolean;
}

/**
 * Run the full setup pipeline. See module header for phase order.
 *
 * Lifecycle:
 *   - Lock is acquired BEFORE the logger is opened. A blocked lock returns
 *     `lock_collision` with no log file (the user-visible message lives on
 *     the UI sink; nothing to log).
 *   - After the logger opens, we register exit + SIGINT handlers that release
 *     the lock and close the logger. Both ops are idempotent and are also
 *     called explicitly in the "happy" return path.
 */
export async function runOrchestrator(
  options: OrchestratorOptions,
): Promise<OrchestratorResult> {
  const { ui, homedir, unpackedDistIndexJsPath } = options;

  const lockfilePath =
    options.lockfilePath ?? join(homedir, '.config', 'concierge', 'setup.lock');
  const logsDir =
    options.logsDir ?? join(homedir, '.config', 'concierge', 'setup-logs');
  const assetsDir = options.assetsDir ?? defaultAssetsDir();

  // -------------------------------------------------------------------------
  // Phase 0a: read the embedded manifest (needed for setupVersion in the
  // lockfile body). Failure here is structurally fatal.
  // -------------------------------------------------------------------------
  let manifest: EmbeddedManifest;
  try {
    manifest = await readEmbeddedManifest(join(assetsDir, 'manifest.json'));
  } catch (err) {
    ui.showFailure(
      'manifest',
      `Could not read embedded manifest: ${safeMsg(err)}`,
    );
    return { outcome: 'failure', exitCode: 3, failedPhase: 'manifest' };
  }
  const mcpbPath =
    options.mcpbPath ?? join(assetsDir, manifest.bundledMcpb.filename);

  // -------------------------------------------------------------------------
  // Phase 1: acquireLock
  // -------------------------------------------------------------------------
  const lockResult = await acquireLock(lockfilePath, manifest.setupVersion);
  if (lockResult.kind === 'blocked') {
    ui.showLockCollision(lockResult.holder.pid, lockResult.holder.startedAt);
    return { outcome: 'lock_collision', exitCode: 1 };
  }

  const artifacts: ExitArtifacts = {
    releaseLock: lockResult.release,
    logger: null,
    installedExitHandler: false,
    installedSigintHandler: false,
  };

  // Cleanup is idempotent; both paths (signal + normal) can call it.
  let cleanedUp = false;
  const cleanup = async (): Promise<void> => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      await artifacts.releaseLock();
    } catch {
      // never throw on cleanup
    }
    if (artifacts.logger !== null) {
      try {
        await artifacts.logger.close();
      } catch {
        // already-closed / swallow
      }
    }
  };

  // Sync wrappers for `process.on('exit')` (no awaits allowed in 'exit').
  const syncExitHandler = (): void => {
    // Best-effort: fire and forget. Lock release and logger close are both
    // safe to invoke without an await — Node will flush what it can before
    // the process tears down.
    void cleanup();
  };
  const sigintHandler = (): void => {
    void cleanup().finally(() => {
      // Re-raise the default SIGINT exit code (130) so the parent shell sees
      // a normal interrupt, not a clean exit.
      process.exit(130);
    });
  };

  try {
    // ---------------------------------------------------------------------
    // Phase 2: openLogger
    // ---------------------------------------------------------------------
    let logger: SetupLogger;
    try {
      logger = await openLogger({ logsDir });
    } catch (err) {
      ui.showFailure('logger', `Could not open log file: ${safeMsg(err)}`);
      await cleanup();
      return { outcome: 'failure', exitCode: 3, failedPhase: 'logger' };
    }
    artifacts.logger = logger;

    process.on('exit', syncExitHandler);
    artifacts.installedExitHandler = true;
    process.on('SIGINT', sigintHandler);
    artifacts.installedSigintHandler = true;

    logger.info('orchestrator', 'started', {
      setupVersion: manifest.setupVersion,
      mcpbVersion: manifest.bundledMcpb.version,
    });

    const logPath = logger.getPath();

    // ---------------------------------------------------------------------
    // Phase 3: checkForUpdate (best-effort)
    // ---------------------------------------------------------------------
    if (options.skipUpdateCheck !== true) {
      try {
        const updateRes = await checkForUpdate({
          currentVersion: manifest.setupVersion,
        });
        logger.info('updateCheck', 'result', {
          newer: updateRes.newer,
          latestTag: updateRes.latestTag,
          skipReason: updateRes.skipReason,
        });
      } catch (err) {
        // Best-effort — never block the run.
        logger.warn('updateCheck', 'threw', { err: safeMsg(err) });
      }
    }

    // ---------------------------------------------------------------------
    // Phase 4: banner
    // ---------------------------------------------------------------------
    ui.banner();

    // ---------------------------------------------------------------------
    // Phase 5: probes
    // ---------------------------------------------------------------------
    let probes: readonly ProbeResult[];
    try {
      const probeCtx: ProbeContext = {
        homedir,
        unpackedDistIndexJsPath,
        claudeCliExpectedPath: unpackedDistIndexJsPath,
        manifest,
      };
      probes = await runAllProbes(probeCtx);
    } catch (err) {
      const msg = safeMsg(err);
      logger.error('probe', 'fatal', { err: msg });
      ui.showFailure('probe', 'Probe phase crashed.');
      await cleanup();
      return {
        outcome: 'failure',
        exitCode: 3,
        logPath,
        failedPhase: 'probe',
      };
    }
    for (const p of probes) {
      ui.showProbeProgress(p.name, uiProbeStatus(p.status));
      logger.info('probe', p.name, { status: p.status });
    }

    // ---------------------------------------------------------------------
    // Phase 6: consent screen + admin-gate detection
    // ---------------------------------------------------------------------
    let consentScreen: ConsentScreen;
    try {
      consentScreen = buildConsentScreen(probes);
    } catch (err) {
      const msg = safeMsg(err);
      logger.error('consent', 'buildConsentScreen threw', { err: msg });
      ui.showFailure('consent', 'Could not build consent screen.');
      await cleanup();
      return {
        outcome: 'failure',
        exitCode: 3,
        logPath,
        failedPhase: 'consent',
      };
    }

    // Admin gate: any migration rule with `behavior: 'pause-with-fix'` triggers
    // an admin handout. We re-iterate MIGRATION_RULES via captureConsent() but
    // for the gate we only need to know that one would match — surface here
    // before any prompt by inspecting the consent text.
    // Implementation: ask captureConsent with a "would-not-prompt" capture
    // function. If it returns autoApproved=false but the rule list has a
    // pause-with-fix, we treat that as the admin gate.
    // Captured below in Phase 7's flow.

    // ---------------------------------------------------------------------
    // Phase 7: captureConsent
    // ---------------------------------------------------------------------
    let consentDecision: Awaited<ReturnType<typeof captureConsent>>;
    try {
      consentDecision = await captureConsent(probes, {
        prompt: async (screen) => {
          const { accepted } = await ui.showConsentScreen(
            renderConsentText(screen),
          );
          return accepted;
        },
      });
    } catch (err) {
      const msg = safeMsg(err);
      logger.error('consent', 'captureConsent threw', { err: msg });
      ui.showFailure('consent', 'Consent capture failed.');
      await cleanup();
      return {
        outcome: 'failure',
        exitCode: 3,
        logPath,
        failedPhase: 'consent',
      };
    }

    // Admin-gate branch — at least one migration demanded a pause-with-fix.
    const pauseFix = consentDecision.migrations.find(
      (m) => m.behavior === 'pause-with-fix',
    );
    if (pauseFix !== undefined) {
      const text = renderAdminGateText(
        pauseFix.fixHint ?? 'Manual fix required (see docs).',
        consentScreen,
      );
      logger.warn('consent', 'admin_gate', { ruleId: pauseFix.ruleId });
      await ui.showAdminGate(text);
      await cleanup();
      return { outcome: 'admin_gate', exitCode: 2, logPath };
    }

    if (!consentDecision.approved) {
      logger.warn('consent', 'rejected', {});
      ui.showFailure('consent', 'Consent declined — aborting setup.');
      await cleanup();
      return {
        outcome: 'failure',
        exitCode: 3,
        logPath,
        failedPhase: 'consent',
      };
    }

    // ---------------------------------------------------------------------
    // Phase 8: planInstallSteps + runInstallSteps
    // ---------------------------------------------------------------------
    let installResults: readonly InstallResult[];
    try {
      const steps = planInstallSteps(probes);
      for (const s of steps) {
        ui.showInstallProgress(s.tool, 'starting');
      }
      installResults = await runInstallSteps(steps, {
        onProgress: (line) => {
          // Stream raw subprocess lines into the log; UI gets bracketed
          // start/done events below.
          logger.info('install', line);
        },
      });
    } catch (err) {
      const msg = safeMsg(err);
      logger.error('install', 'threw', { err: msg });
      ui.showFailure('install', 'Install phase crashed.');
      await cleanup();
      return {
        outcome: 'failure',
        exitCode: 3,
        logPath,
        failedPhase: 'install',
      };
    }
    for (const r of installResults) {
      const phase = r.status === 'failed' ? 'failed' : 'done';
      ui.showInstallProgress(r.tool, phase, r.version);
      logger.info('install', r.tool, {
        status: r.status,
        version: r.version,
      });
    }
    const failedInstall = installResults.find((r) => r.status === 'failed');
    if (failedInstall !== undefined) {
      const detail = failedInstall.stderr ?? 'no stderr captured';
      logger.error('install', 'failed', {
        tool: failedInstall.tool,
        stderr: redactStringForLog(detail),
      });
      ui.showFailure(
        'install',
        `Install of ${failedInstall.tool} failed. See log for details.`,
      );
      await cleanup();
      return {
        outcome: 'failure',
        exitCode: 3,
        logPath,
        failedPhase: 'install',
      };
    }

    // ---------------------------------------------------------------------
    // Phase 9: gws auth setup (only if no client_secret yet)
    // ---------------------------------------------------------------------
    if (clientSecretMissing(probes)) {
      try {
        const setupRes = await runGwsAuthSetup({
          suggestedProjectId: suggestedProjectId(probes),
          accountType: deriveExpectedAccountType(probes),
        });
        logger.info('oauth.setup', setupRes.kind);
        if (setupRes.kind === 'placeholder_project_id') {
          ui.showFailure(
            'oauth.setup',
            `Detected placeholder project_id "${setupRes.suspectedProjectId}". ` +
              'See docs/setup/user-onboarding.md for the recovery steps.',
          );
          await cleanup();
          return {
            outcome: 'failure',
            exitCode: 3,
            logPath,
            failedPhase: 'oauth.setup',
          };
        }
        if (setupRes.kind === 'gws_punted') {
          ui.showFailure('oauth.setup', setupRes.helpText);
          await cleanup();
          return {
            outcome: 'failure',
            exitCode: 3,
            logPath,
            failedPhase: 'oauth.setup',
          };
        }
        if (setupRes.kind === 'subprocess_failed') {
          ui.showFailure(
            'oauth.setup',
            `gws auth setup failed (exit ${String(setupRes.exitCode)}).`,
          );
          logger.error('oauth.setup', 'subprocess_failed', {
            stderr: redactStringForLog(setupRes.stderr),
          });
          await cleanup();
          return {
            outcome: 'failure',
            exitCode: 3,
            logPath,
            failedPhase: 'oauth.setup',
          };
        }
      } catch (err) {
        const msg = safeMsg(err);
        logger.error('oauth.setup', 'threw', { err: msg });
        ui.showFailure('oauth.setup', 'gws auth setup crashed.');
        await cleanup();
        return {
          outcome: 'failure',
          exitCode: 3,
          logPath,
          failedPhase: 'oauth.setup',
        };
      }
    }

    // ---------------------------------------------------------------------
    // Phase 10: gws auth login
    // ---------------------------------------------------------------------
    try {
      ui.showOauthWait();
      const loginRes = await runGwsAuthLogin({
        services: DEFAULT_OAUTH_SERVICES,
        expectedAccountType: deriveExpectedAccountType(probes),
      });
      logger.info('oauth.login', loginRes.kind);
      if (loginRes.kind === 'port_collision') {
        ui.showFailure(
          'oauth.login',
          `Could not bind OAuth redirect port ${String(loginRes.port)} ` +
            '(another process is using it). Free the port and re-run, or ' +
            'use lsof to identify the holder: `lsof -i :' +
            String(loginRes.port) +
            '`.',
          `lsof -i :${String(loginRes.port)}`,
        );
        await cleanup();
        return {
          outcome: 'failure',
          exitCode: 3,
          logPath,
          failedPhase: 'oauth.login',
        };
      }
      if (loginRes.kind === 'account_mismatch') {
        ui.showFailure(
          'oauth.login',
          `Account domain mismatch: expected ${loginRes.expectedType} but ` +
            `signed in as ${loginRes.userDomain} (${loginRes.actualType}).`,
        );
        await cleanup();
        return {
          outcome: 'failure',
          exitCode: 3,
          logPath,
          failedPhase: 'oauth.login',
        };
      }
      if (loginRes.kind === 'oauth_browser_failed') {
        ui.showFailure(
          'oauth.login',
          'Could not open the OAuth browser. Copy the URL printed by gws ' +
            'into a browser manually.',
        );
        logger.error('oauth.login', 'browser_failed', {
          stderr: redactStringForLog(loginRes.stderr),
        });
        await cleanup();
        return {
          outcome: 'failure',
          exitCode: 3,
          logPath,
          failedPhase: 'oauth.login',
        };
      }
      if (loginRes.kind === 'subprocess_failed') {
        ui.showFailure(
          'oauth.login',
          `gws auth login failed (exit ${String(loginRes.exitCode)}).`,
        );
        logger.error('oauth.login', 'subprocess_failed', {
          stderr: redactStringForLog(loginRes.stderr),
        });
        await cleanup();
        return {
          outcome: 'failure',
          exitCode: 3,
          logPath,
          failedPhase: 'oauth.login',
        };
      }
      // Success — confirm domain classification matches our expectation.
      const actualType = classifyAccountDomain(loginRes.user);
      logger.info('oauth.login', 'authenticated', { actualType });
    } catch (err) {
      const msg = safeMsg(err);
      logger.error('oauth.login', 'threw', { err: msg });
      ui.showFailure('oauth.login', 'gws auth login crashed.');
      await cleanup();
      return {
        outcome: 'failure',
        exitCode: 3,
        logPath,
        failedPhase: 'oauth.login',
      };
    }

    // ---------------------------------------------------------------------
    // Phase 11: registerClaude
    // ---------------------------------------------------------------------
    try {
      const regRes = await registerClaude({
        manifest,
        mcpbPath,
        unpackedDistIndexJsPath,
        homedir,
      });
      logger.info('register', 'desktop', {
        status: regRes.desktop.status,
        detail: regRes.desktop.detail,
      });
      logger.info('register', 'cli', {
        status: regRes.cli.status,
        detail: regRes.cli.detail,
      });
      if (
        regRes.desktop.status === 'failed' ||
        regRes.cli.status === 'failed'
      ) {
        ui.showFailure(
          'register',
          'Could not register Concierge with Claude. See log for details.',
        );
        await cleanup();
        return {
          outcome: 'failure',
          exitCode: 3,
          logPath,
          failedPhase: 'register',
        };
      }
    } catch (err) {
      const msg = safeMsg(err);
      logger.error('register', 'threw', { err: msg });
      ui.showFailure('register', 'Claude registration crashed.');
      await cleanup();
      return {
        outcome: 'failure',
        exitCode: 3,
        logPath,
        failedPhase: 'register',
      };
    }

    // ---------------------------------------------------------------------
    // Phase 12: verifyInstall (with at most one runRecovery retry)
    // ---------------------------------------------------------------------
    const targets = resolveTargets(probes);
    let recoveredAfterRetry = false;
    try {
      const firstVerify = await verifyInstall({
        manifest,
        unpackedDistIndexJsPath,
        homedir,
        targets,
      });
      logger.info('verify', 'first', {
        allTargetsPassed: firstVerify.allTargetsPassed,
      });
      if (!firstVerify.allTargetsPassed) {
        // ONE retry budget per locked verification policy.
        const recoverRes = await runRecovery({
          manifest,
          mcpbPath,
          unpackedDistIndexJsPath,
          homedir,
          targets,
          onProgress: (line) => {
            logger.info('recover', line);
          },
        });
        logger.info('verify', 'after_recovery', {
          recovered: recoverRes.recovered,
        });
        if (!recoverRes.recovered) {
          ui.showFailure(
            'verify',
            'Verification failed after one recovery attempt. See log for details.',
          );
          await cleanup();
          return {
            outcome: 'failure',
            exitCode: 3,
            logPath,
            failedPhase: 'verify',
          };
        }
        recoveredAfterRetry = true;
      }
    } catch (err) {
      const msg = safeMsg(err);
      logger.error('verify', 'threw', { err: msg });
      ui.showFailure('verify', 'Verification crashed.');
      await cleanup();
      return {
        outcome: 'failure',
        exitCode: 3,
        logPath,
        failedPhase: 'verify',
      };
    }

    // ---------------------------------------------------------------------
    // Phase 13: success
    // ---------------------------------------------------------------------
    const successText = recoveredAfterRetry
      ? 'Concierge is set up. (Recovery succeeded after one retry.)'
      : 'Concierge is set up.';
    ui.showSuccess(successText);
    logger.info('orchestrator', 'success', {
      recoveredAfterRetry,
    });
    await cleanup();
    return {
      outcome: recoveredAfterRetry ? 'recovered_after_retry' : 'success',
      exitCode: 0,
      logPath,
    };
  } catch (err) {
    // Catastrophic, uncaught — failsafe so the lock always releases.
    const msg = safeMsg(err);
    if (artifacts.logger !== null) {
      artifacts.logger.error('orchestrator', 'uncaught', { err: msg });
    }
    ui.showFailure('orchestrator', `Unexpected error: ${msg}`);
    await cleanup();
    return {
      outcome: 'failure',
      exitCode: 3,
      failedPhase: 'orchestrator',
    };
  } finally {
    // Drop the SIGINT handler if we installed one — the orchestrator process
    // may be a long-lived host (test runner) and we don't want to leak.
    if (artifacts.installedSigintHandler) {
      try {
        process.removeListener('SIGINT', sigintHandler);
      } catch {
        // best-effort
      }
    }
    if (artifacts.installedExitHandler) {
      try {
        process.removeListener('exit', syncExitHandler);
      } catch {
        // best-effort
      }
    }
  }
}
