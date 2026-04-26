// Probe result types for the setup orchestrator.
// Discriminated union: shared envelope (`ProbeResult`) + per-probe `Detail` interfaces.
// See docs/specs/setup-hardening-v2/plan.md §Data & State for the probe table that
// drives ProbeName + Detail shape coverage.

export type ProbeStatus = 'ok' | 'missing' | 'stale' | 'broken' | 'skipped';

export type ProbeName =
  | 'brew'
  | 'node'
  | 'gws'
  | 'gws.version'
  | 'gcloud'
  | 'gcloud.appDefault'
  | 'claude.cli'
  | 'claude.desktop'
  | 'gws.clientSecret'
  | 'gcp.apisEnabled'
  | 'gws.authStatus'
  | 'account.domain'
  | 'mcpb.desktop'
  | 'mcpb.cli'
  | 'verify.endToEnd';

export interface ProbeResult<TDetail = unknown> {
  name: ProbeName;
  status: ProbeStatus;
  detail?: TDetail;
  durationMs: number;
  timestamp: string; // ISO-8601
}

// --- Per-probe Detail interfaces -------------------------------------------

export interface BrewDetail {
  version: string;
}

export interface NodeDetail {
  version: string;
  major: number;
}

export interface GwsDetail {
  version: string;
  absPath: string;
}

// Composite probe per plan C1: collapses gws + gws.version
export interface GwsVersionDetail {
  installed: string;
  required: string;
  needsUpgrade: boolean;
}

export interface GcloudDetail {
  version: string;
}

export interface GcloudAppDefaultDetail {
  hasToken: boolean;
  expiresAt?: string;
}

export interface ClaudeCliDetail {
  version: string;
  absPath: string;
}

export interface ClaudeDesktopDetail {
  absPath: string;
  appPath: '/Applications' | '~/Applications';
}

export interface ClientSecretDetail {
  path: string;
  projectId: string;
  placeholderSuspect: boolean;
  clientIdNumericPrefix: string;
}

export interface ApisEnabledDetail {
  project: string;
  enabled: readonly string[];
  missing: readonly string[];
}

export interface AuthStatusDetail {
  user: string;
  tokenValid: boolean;
  projectId: string;
  scopes: readonly string[];
}

export interface AccountDomainDetail {
  user: string;
  domain: string;
  type: 'personal' | 'workspace';
}

export interface McpbDesktopDetail {
  unpackedPath: string;
  bundledSha: string;
  installedSha: string;
  namespace: string;
  matches: boolean;
}

export interface McpbCliDetail {
  claudeJsonPath: string;
  registered: boolean;
  expectedAbsPath: string;
  actualAbsPath?: string;
  matches: boolean;
}

export interface VerifyEndToEndDetail {
  target: 'desktop' | 'cli';
  expectedBuildId: string;
  actualBuildId?: string;
  pass: boolean;
  failureMode?:
    | 'sha-mismatch'
    | 'spawn-timeout'
    | 'build-id-mismatch'
    | 'cli-not-registered';
}
