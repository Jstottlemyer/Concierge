// C2: Consent phase.
//
// Pure-function reducer over `ProbeResult[]` from C1. Two responsibilities:
//
//   1. `buildConsentScreen()` — translate probe results into the four content
//      blocks the user sees: detected (already installed), priorInstall (from
//      MIGRATION_RULES, e.g., "Concierge extension v0.X.Y will replace…"),
//      willInstall (missing), willUpgrade (stale). Plus an estimated download
//      size + ETA.
//
//   2. `captureConsent()` — apply MIGRATION_RULES (declarative table, first-
//      match-wins per rule but multiple distinct rules CAN match; D5 in the
//      plan), then either auto-approve (when there's nothing to install AND no
//      pause-with-fix matches) or invoke the injected `prompt` function for the
//      user's Y/n decision.
//
// Per spec §UX flow step 4: "If detected list of *new* installs is empty,
// skip the prompt entirely and proceed." We extend this to also auto-approve
// when there are upgrades-only IF no rule demands a pause-with-fix; the
// install phase handles upgrades transparently. (The spec's UX example shows
// the consent list including upgrades, but the auto-skip rule explicitly says
// "empty install list" — so anything-to-show triggers the prompt.)
//
// MIGRATION_RULES is exported as `readonly const` so tests can iterate it
// directly (G3b coverage requirement).
//
// No I/O. No side effects. The injected `prompt` is the only seam to stdin.

import type { ProbeName, ProbeResult } from '../types/probe.js';
import type {
  ClientSecretDetail,
  GcloudAppDefaultDetail,
  GcloudDetail,
  McpbDesktopDetail,
} from '../types/probe.js';

// ---------------------------------------------------------------------------
// MIGRATION_RULES table (spec §Migration from v0.x)
// ---------------------------------------------------------------------------

export interface MigrationRule {
  id: string;
  /** Predicate over the probe results. */
  matches: (probes: readonly ProbeResult[]) => boolean;
  /** Renders the consent-screen line shown to the user. */
  consentLine: (probes: readonly ProbeResult[]) => string;
  /** What the orchestrator should do as a result of this match. */
  behavior:
    | 'skip-install' // already done, just verify
    | 'run-oauth' // skip install, do OAuth
    | 'pause-with-fix' // prompt user with copy-paste fix; pause
    | 'hard-reinstall' // run recovery
    | 'refuse'; // exit non-zero
  /** For 'pause-with-fix' or 'refuse': human-readable hint. */
  fixHint?: string;
}

/** Find the first probe with `name === target` (or undefined). */
function findProbe<T = unknown>(
  probes: readonly ProbeResult[],
  target: ProbeName,
): ProbeResult<T> | undefined {
  return probes.find((p) => p.name === target) as
    | ProbeResult<T>
    | undefined;
}

/** Doc URL referenced in the placeholder-project-id fix hint. */
const PLACEHOLDER_FIX_DOC_URL =
  'https://github.com/Jstottlemyer/AuthTools/blob/main/docs/setup/user-onboarding.md#placeholder-project-id';

/**
 * Declarative migration matrix. First-match-wins is the per-rule semantic for
 * the rule's own predicate (a rule either matches or doesn't, no rule-pair
 * subsumption). Multiple distinct rules CAN match a single probe set — for
 * example, a stale extension AND a placeholder project_id together produce two
 * migration entries in the decision.
 */
export const MIGRATION_RULES: readonly MigrationRule[] = [
  {
    id: 'v0x-extension-stale',
    matches: (probes) => {
      const p = findProbe<McpbDesktopDetail>(probes, 'mcpb.desktop');
      return p?.status === 'stale';
    },
    consentLine: (probes) => {
      const p = findProbe<McpbDesktopDetail>(probes, 'mcpb.desktop');
      const installed = p?.detail?.installedSha?.slice(0, 7) ?? 'unknown';
      const bundled = p?.detail?.bundledSha?.slice(0, 7) ?? 'new';
      return `Concierge extension (sha ${installed}) — will replace with v${bundled}`;
    },
    behavior: 'hard-reinstall',
  },
  {
    id: 'half-completed-no-auth',
    matches: (probes) => {
      const cs = findProbe(probes, 'gws.clientSecret');
      const auth = findProbe(probes, 'gws.authStatus');
      return cs?.status === 'ok' && auth?.status === 'missing';
    },
    consentLine: () =>
      'OAuth credentials present but not authenticated (will complete sign-in)',
    behavior: 'run-oauth',
  },
  {
    id: 'placeholder-project-id',
    matches: (probes) => {
      const cs = findProbe<ClientSecretDetail>(probes, 'gws.clientSecret');
      return cs?.detail?.placeholderSuspect === true;
    },
    consentLine: () =>
      'OAuth credentials need a fix (placeholder project_id)',
    behavior: 'pause-with-fix',
    fixHint:
      `Open ${PLACEHOLDER_FIX_DOC_URL} for the recovery steps. ` +
      'In short: open Cloud Console (project number = numeric prefix of your ' +
      'OAuth client_id), copy the real "Project ID" string from Project Info, ' +
      'and replace the `installed.project_id` field in ' +
      '~/.config/gws/client_secret.json. No OAuth re-auth needed.',
  },
  {
    id: 'gcloud-app-default-missing',
    matches: (probes) => {
      const gcloud = findProbe<GcloudDetail>(probes, 'gcloud');
      const ad = findProbe<GcloudAppDefaultDetail>(
        probes,
        'gcloud.appDefault',
      );
      return gcloud?.status === 'ok' && ad?.status === 'missing';
    },
    consentLine: () =>
      'gcloud needs additional authentication (will run during install)',
    behavior: 'run-oauth',
  },
  {
    id: 'account-mismatch',
    // v2.0 has no on-disk state file recording a previously-stored email,
    // so this rule is a placeholder for the future. Today it never matches.
    // (See plan D5 + spec §Migration from v0.x last row.)
    matches: () => false,
    consentLine: () =>
      'Different Google account than previously configured (will refuse)',
    behavior: 'refuse',
  },
];

// ---------------------------------------------------------------------------
// Consent screen (pure)
// ---------------------------------------------------------------------------

export interface ConsentScreen {
  /** Tools already installed (e.g., "Homebrew", "Node 20"). */
  detected: readonly string[];
  /** Lines from MIGRATION_RULES that surface prior Concierge state. */
  priorInstall: readonly string[];
  /** Tools that are missing entirely. */
  willInstall: readonly string[];
  /** Tools present but stale (e.g., "gws CLI 0.21.0 → 0.22.5+"). */
  willUpgrade: readonly string[];
  /** Sum of estimated download sizes (MB) for items in willInstall + willUpgrade. */
  totalSizeMb: number;
  /** Heuristic ETA bucket: "1-2 min" | "3-5 min" | "5-10 min". */
  estimatedMinutes: string;
}

/** Per-tool download-size estimates (MB), per task spec. */
const SIZE_MB: Readonly<Record<string, number>> = {
  brew: 50,
  node: 80,
  gws: 10,
  gcloud: 200,
  'claude.cli': 80,
  'claude.desktop': 250,
};

/** Human label per probe name, for the consent-screen lists. */
const LABEL: Readonly<Record<string, string>> = {
  brew: 'Homebrew',
  node: 'Node',
  gws: 'gws CLI',
  'gws.version': 'gws CLI',
  gcloud: 'gcloud CLI',
  'claude.cli': 'Claude CLI',
  'claude.desktop': 'Claude Desktop',
};

/** The probes whose status we map directly into install/upgrade buckets. */
const TOOL_PROBES: readonly ProbeName[] = [
  'brew',
  'node',
  'gws',
  'gcloud',
  'claude.cli',
  'claude.desktop',
];

function detectedLabel(name: ProbeName, probe: ProbeResult): string {
  const base = LABEL[name] ?? name;
  // Try to surface the version when available (BrewDetail/NodeDetail/etc.
  // all carry a `version` field by convention).
  const detail = probe.detail as { version?: string } | undefined;
  if (detail?.version !== undefined && detail.version !== '') {
    return `${base} ${detail.version}`;
  }
  return base;
}

function upgradeLabel(name: ProbeName, probe: ProbeResult): string {
  const base = LABEL[name] ?? name;
  // gws.version composite probe carries `installed`/`required` — surface it.
  const detail = probe.detail as
    | { installed?: string; required?: string; version?: string }
    | undefined;
  if (detail?.installed !== undefined && detail?.required !== undefined) {
    return `${base} ${detail.installed} → ${detail.required}+`;
  }
  if (detail?.version !== undefined) {
    return `${base} ${detail.version} → newer`;
  }
  return base;
}

function estimateMinutes(totalMb: number): string {
  if (totalMb < 100) return '1-2 min';
  if (totalMb < 300) return '3-5 min';
  return '5-10 min';
}

/**
 * Pure reducer over probe results. No I/O. Deterministic.
 *
 * - status === 'ok'      → detected
 * - status === 'missing' → willInstall
 * - status === 'stale'   → willUpgrade
 * - status === 'broken'  → treated as missing (we'll try to reinstall)
 * - status === 'skipped' → ignored
 *
 * The mcpb.desktop probe is intentionally NOT mapped into willInstall here —
 * it surfaces via MIGRATION_RULES (`v0x-extension-stale`) when stale.
 */
export function buildConsentScreen(
  probes: readonly ProbeResult[],
): ConsentScreen {
  const detected: string[] = [];
  const willInstall: string[] = [];
  const willUpgrade: string[] = [];
  let totalSizeMb = 0;

  for (const name of TOOL_PROBES) {
    const probe = findProbe(probes, name);
    if (probe === undefined) continue;
    switch (probe.status) {
      case 'ok':
        detected.push(detectedLabel(name, probe));
        break;
      case 'missing':
      case 'broken':
        willInstall.push(LABEL[name] ?? name);
        totalSizeMb += SIZE_MB[name] ?? 0;
        break;
      case 'stale':
        willUpgrade.push(upgradeLabel(name, probe));
        // Upgrades typically re-download the package; count the same size.
        totalSizeMb += SIZE_MB[name] ?? 0;
        break;
      case 'skipped':
        // intentionally ignored
        break;
    }
  }

  // Composite gws.version probe: if `gws` itself was 'ok' (so we didn't
  // already enqueue a fresh install) but the version is stale, surface as an
  // upgrade. This is the only probe that's NOT in TOOL_PROBES but contributes
  // to the install/upgrade lists (per spec §UX flow + N13 auto-upgrade gate).
  const gwsProbe = findProbe(probes, 'gws');
  const gwsVersionProbe = findProbe<{ installed: string; required: string }>(
    probes,
    'gws.version',
  );
  if (
    gwsProbe?.status === 'ok' &&
    gwsVersionProbe?.status === 'stale' &&
    !willUpgrade.some((s) => s.startsWith('gws CLI'))
  ) {
    willUpgrade.push(upgradeLabel('gws.version', gwsVersionProbe));
    totalSizeMb += SIZE_MB['gws'] ?? 0;
  }

  const priorInstall: string[] = [];
  for (const rule of MIGRATION_RULES) {
    if (rule.matches(probes)) {
      priorInstall.push(rule.consentLine(probes));
    }
  }

  return {
    detected,
    priorInstall,
    willInstall,
    willUpgrade,
    totalSizeMb,
    estimatedMinutes: estimateMinutes(totalSizeMb),
  };
}

// ---------------------------------------------------------------------------
// Decision capture
// ---------------------------------------------------------------------------

export interface ConsentMigration {
  ruleId: string;
  behavior: MigrationRule['behavior'];
  fixHint?: string;
}

export interface ConsentDecision {
  approved: boolean;
  /** Empty install + no upgrades + no pause-with-fix = auto-approved (no prompt). */
  autoApproved: boolean;
  /** Resolutions from MIGRATION_RULES that affect downstream phases. */
  migrations: readonly ConsentMigration[];
}

export interface PromptOptions {
  /** Function that renders the screen + reads stdin. Tests inject. */
  prompt: (screen: ConsentScreen) => Promise<boolean>;
}

/**
 * Build the consent screen, gather migration matches, and either auto-approve
 * (nothing to do) or invoke `options.prompt` for the user's Y/n decision.
 *
 * Auto-approval rule: willInstall AND willUpgrade BOTH empty AND no rule
 * matched with `behavior: 'pause-with-fix'`. (A pause-with-fix demands user
 * action regardless of whether anything is being installed.)
 */
export async function captureConsent(
  probes: readonly ProbeResult[],
  options: PromptOptions,
): Promise<ConsentDecision> {
  const screen = buildConsentScreen(probes);

  const migrations: ConsentMigration[] = [];
  for (const rule of MIGRATION_RULES) {
    if (rule.matches(probes)) {
      migrations.push({
        ruleId: rule.id,
        behavior: rule.behavior,
        ...(rule.fixHint !== undefined ? { fixHint: rule.fixHint } : {}),
      });
    }
  }

  const hasPauseWithFix = migrations.some(
    (m) => m.behavior === 'pause-with-fix',
  );
  const nothingToDo =
    screen.willInstall.length === 0 && screen.willUpgrade.length === 0;

  if (nothingToDo && !hasPauseWithFix) {
    return {
      approved: true,
      autoApproved: true,
      migrations,
    };
  }

  const approved = await options.prompt(screen);
  return {
    approved,
    autoApproved: false,
    migrations,
  };
}
