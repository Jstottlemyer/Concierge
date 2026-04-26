// C1: Probe orchestration phase.
//
// Runs all 15 stateless probes from the spec's §Data table in parallel via
// `Promise.all`. Each probe handles its own errors and returns a
// `ProbeResult` with `status: 'broken'` rather than throwing — fan-out must
// not be poisoned by one probe's failure.
//
// Per plan D8 + C1: probes are the only phase that runs in parallel; the
// rest of the orchestrator is serial. The only intra-probe dependency
// (gws-installed gates gws-version) is collapsed into a single composite
// probe that runs `command -v gws && gws --version` once and constructs
// BOTH `gws` and `gws.version` ProbeResult entries from the single output.
//
// Likewise account.domain is derived from gws.authStatus and is not a
// fresh subprocess invocation.
//
// Test routing: each subprocess respects the same env-var overrides as
// `phases/oauth.ts` (`CONCIERGE_TEST_GWS_BIN`, `CONCIERGE_TEST_GWS_DIR`)
// so the F2a/F2b shims can stand in for real gws/claude binaries.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { probeClaudeRegistration } from '../state/claudeJson.js';
import {
  readGwsClientSecret,
  stat as roStat,
} from '../io/readonly.js';
import type { EmbeddedManifest } from '../types/manifest.js';
import type {
  AccountDomainDetail,
  ApisEnabledDetail,
  AuthStatusDetail,
  BrewDetail,
  ClaudeCliDetail,
  ClaudeDesktopDetail,
  ClientSecretDetail,
  GcloudAppDefaultDetail,
  GcloudDetail,
  GwsDetail,
  GwsVersionDetail,
  McpbCliDetail,
  McpbDesktopDetail,
  NodeDetail,
  ProbeName,
  ProbeResult,
  ProbeStatus,
  VerifyEndToEndDetail,
} from '../types/probe.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ProbeContext {
  homedir: string;
  /** Path to the embedded .mcpb's unpacked dist/index.js (orchestrator-owned mktemp -d). */
  unpackedDistIndexJsPath?: string;
  /** Expected absolute path Claude CLI should reference (matches above). */
  claudeCliExpectedPath?: string;
  /** Loaded embedded manifest (B2 result). */
  manifest?: EmbeddedManifest;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Productivity bundle short-names compared against `gcloud services list`. */
const PRODUCTIVITY_APIS: readonly string[] = [
  'gmail',
  'drive',
  'docs',
  'sheets',
  'calendar',
  'forms',
  'tasks',
  'slides',
  'chat',
  'meet',
  'people',
  'script',
];

/** Heuristic for detecting placeholder Project IDs (from CLAUDE.md known-bad
 *  pattern: `authtools-spike` and similar tutorial-name shapes). */
const PLACEHOLDER_PROJECT_ID_RE =
  /^(authtools|concierge)-(?:spike|test|placeholder|example|sample|demo)$/i;

/** Domains we treat as personal Gmail (matches `phases/oauth.ts`). */
const PERSONAL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com',
  'googlemail.com',
]);

/** Required gws version (matches spec §Data table + plan C3 auto-upgrade gate). */
const REQUIRED_GWS_VERSION = '0.22.5';

// ---------------------------------------------------------------------------
// Subprocess helpers
// ---------------------------------------------------------------------------

interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Run a binary and capture stdout/stderr/exit-code without throwing on
 *  non-zero exit. Resolves with the captured result on either spawn-error
 *  (code: -1) or normal exit. */
async function runCommand(
  bin: string,
  args: readonly string[],
  env?: NodeJS.ProcessEnv,
): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      bin,
      [...args],
      {
        encoding: 'utf8',
        env: env ?? process.env,
        // 10s should be ample for any version probe; gcloud cold start is the
        // slowest here (~2-3s on a fresh machine).
        timeout: 10_000,
      },
      (err, stdout, stderr) => {
        if (err !== null) {
          // execFile populates err.code with the *exit code* on non-zero exit.
          // On spawn failure (ENOENT / EACCES) err.code is the libc string —
          // map those to -1 so callers branch on `code !== 0` cleanly.
          const codeAny = (err as NodeJS.ErrnoException & { code?: unknown })
            .code;
          const exitCode = typeof codeAny === 'number' ? codeAny : -1;
          resolve({ stdout, stderr, code: exitCode });
          return;
        }
        resolve({ stdout, stderr, code: 0 });
      },
    );
  });
}

/** Return true if `command -v <bin>` succeeds, capturing the absolute path. */
async function whichBin(bin: string): Promise<{ found: boolean; path: string }> {
  // `command -v` is POSIX-portable and avoids spawning a sub-shell with
  // `which` (not always present in minimal containers). We invoke it via
  // /bin/sh -c so shell builtin lookup works.
  const res = await runCommand('/bin/sh', ['-c', `command -v ${bin}`]);
  if (res.code !== 0) return { found: false, path: '' };
  return { found: true, path: res.stdout.trim() };
}

// ---------------------------------------------------------------------------
// Per-probe wrappers
// ---------------------------------------------------------------------------

/** Build a stamped ProbeResult around a probe-body that returns `{status, detail?}`. */
async function timed<T>(
  name: ProbeName,
  body: () => Promise<{ status: ProbeStatus; detail?: T }>,
): Promise<ProbeResult<T>> {
  const start = performance.now();
  let status: ProbeStatus = 'broken';
  let detail: T | undefined;
  try {
    const out = await body();
    status = out.status;
    detail = out.detail;
  } catch {
    // Per plan: each probe handles its own errors — return status:broken
    // rather than throwing, so Promise.all never rejects.
    status = 'broken';
  }
  const durationMs = performance.now() - start;
  const result: ProbeResult<T> = {
    name,
    status,
    durationMs,
    timestamp: new Date().toISOString(),
  };
  if (detail !== undefined) {
    (result as { detail?: T }).detail = detail;
  }
  return result;
}

// --- brew -------------------------------------------------------------------

async function probeBrew(): Promise<ProbeResult<BrewDetail>> {
  return timed('brew', async () => {
    const w = await whichBin('brew');
    if (!w.found) return { status: 'missing' };
    const v = await runCommand('brew', ['--version']);
    if (v.code !== 0) return { status: 'broken' };
    // First line typically: `Homebrew 4.5.2`.
    const line = v.stdout.split('\n')[0] ?? '';
    const m = /Homebrew\s+([\w.\-+]+)/.exec(line);
    const version = m !== null ? m[1] : line.trim();
    return { status: 'ok', detail: { version: version ?? '' } };
  });
}

// --- node -------------------------------------------------------------------

async function probeNode(): Promise<ProbeResult<NodeDetail>> {
  return timed('node', async () => {
    const w = await whichBin('node');
    if (!w.found) return { status: 'missing' };
    const v = await runCommand('node', ['--version']);
    if (v.code !== 0) return { status: 'broken' };
    // Output: `v20.10.0`
    const raw = v.stdout.trim();
    const trimmed = raw.startsWith('v') ? raw.slice(1) : raw;
    const major = Number.parseInt(trimmed.split('.')[0] ?? '0', 10);
    return {
      status: 'ok',
      detail: {
        version: trimmed,
        major: Number.isFinite(major) ? major : 0,
      },
    };
  });
}

// --- composite gws + gws.version -------------------------------------------

interface GwsCompositeOutput {
  gws: ProbeResult<GwsDetail>;
  gwsVersion: ProbeResult<GwsVersionDetail>;
}

/** Run `command -v gws && gws --version` once, then build BOTH probe results
 *  from the single observation. This is the only intra-probe dependency in
 *  the spec table; collapsing it here lets the rest fan out cleanly. */
async function probeGwsComposite(): Promise<GwsCompositeOutput> {
  const start = performance.now();
  const stamp = new Date().toISOString();

  const bin = process.env['CONCIERGE_TEST_GWS_BIN'] ?? 'gws';

  // Resolve the absolute path via `command -v`; for the test-injected absolute
  // path we trust it as-is.
  let absPath = '';
  if (process.env['CONCIERGE_TEST_GWS_BIN'] !== undefined) {
    absPath = bin;
  } else {
    const w = await whichBin('gws');
    if (!w.found) {
      const dur = performance.now() - start;
      const missing: ProbeResult<GwsDetail> = {
        name: 'gws',
        status: 'missing',
        durationMs: dur,
        timestamp: stamp,
      };
      const skipped: ProbeResult<GwsVersionDetail> = {
        name: 'gws.version',
        status: 'skipped',
        durationMs: 0,
        timestamp: stamp,
      };
      return { gws: missing, gwsVersion: skipped };
    }
    absPath = w.path;
  }

  const v = await runCommand(bin, ['--version']);
  const dur = performance.now() - start;

  if (v.code !== 0) {
    const broken: ProbeResult<GwsDetail> = {
      name: 'gws',
      status: 'broken',
      durationMs: dur,
      timestamp: stamp,
    };
    const skipped: ProbeResult<GwsVersionDetail> = {
      name: 'gws.version',
      status: 'skipped',
      durationMs: 0,
      timestamp: stamp,
    };
    return { gws: broken, gwsVersion: skipped };
  }

  // Output: `gws 0.22.5` or `gws 0.22.5 (test shim)`.
  const m = /gws\s+([0-9]+\.[0-9]+\.[0-9]+(?:[-+][\w.-]+)?)/.exec(v.stdout);
  const version = m !== null && m[1] !== undefined ? m[1] : v.stdout.trim();

  const gwsResult: ProbeResult<GwsDetail> = {
    name: 'gws',
    status: 'ok',
    detail: { version, absPath },
    durationMs: dur,
    timestamp: stamp,
  };

  const needsUpgrade = compareSemverLt(version, REQUIRED_GWS_VERSION);
  const gwsVersionResult: ProbeResult<GwsVersionDetail> = {
    name: 'gws.version',
    status: needsUpgrade ? 'stale' : 'ok',
    detail: {
      installed: version,
      required: REQUIRED_GWS_VERSION,
      needsUpgrade,
    },
    durationMs: 0, // composite — version compare is in-memory
    timestamp: stamp,
  };

  return { gws: gwsResult, gwsVersion: gwsVersionResult };
}

/** Strict-numeric semver lt comparison. Avoids a node-semver dep at this
 *  layer (plan C3 owns the "official" semver compare via node-semver in the
 *  install phase). For probe purposes we just need ordered tuples. */
function compareSemverLt(a: string, b: string): boolean {
  const pa = parseSemverTuple(a);
  const pb = parseSemverTuple(b);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return true;
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return false;
  }
  return false;
}

function parseSemverTuple(v: string): [number, number, number] {
  const m = /^([0-9]+)\.([0-9]+)\.([0-9]+)/.exec(v);
  if (m === null) return [0, 0, 0];
  return [
    Number.parseInt(m[1] ?? '0', 10),
    Number.parseInt(m[2] ?? '0', 10),
    Number.parseInt(m[3] ?? '0', 10),
  ];
}

// --- gcloud + gcloud.appDefault --------------------------------------------

async function probeGcloud(): Promise<ProbeResult<GcloudDetail>> {
  return timed('gcloud', async () => {
    const w = await whichBin('gcloud');
    if (!w.found) return { status: 'missing' };
    const v = await runCommand('gcloud', ['--version']);
    if (v.code !== 0) return { status: 'broken' };
    // First line: `Google Cloud SDK 470.0.0`
    const line = v.stdout.split('\n')[0] ?? '';
    const m = /Google Cloud SDK\s+([\w.\-+]+)/.exec(line);
    const version = m !== null && m[1] !== undefined ? m[1] : line.trim();
    return { status: 'ok', detail: { version } };
  });
}

async function probeGcloudAppDefault(): Promise<
  ProbeResult<GcloudAppDefaultDetail>
> {
  return timed<GcloudAppDefaultDetail>('gcloud.appDefault', async () => {
    const w = await whichBin('gcloud');
    if (!w.found) return { status: 'missing' };
    const v = await runCommand('gcloud', [
      'auth',
      'application-default',
      'print-access-token',
    ]);
    if (v.code !== 0) {
      return { status: 'missing', detail: { hasToken: false } };
    }
    return { status: 'ok', detail: { hasToken: true } };
  });
}

// --- claude.cli -------------------------------------------------------------

async function probeClaudeCli(): Promise<ProbeResult<ClaudeCliDetail>> {
  return timed('claude.cli', async () => {
    const w = await whichBin('claude');
    if (!w.found) return { status: 'missing' };
    const v = await runCommand('claude', ['--version']);
    if (v.code !== 0) return { status: 'broken' };
    // Shim emits: `claude 1.0.42 (test shim)`. Real claude: `claude 1.0.42`.
    const m = /claude\s+([\w.\-+]+)/.exec(v.stdout);
    const version = m !== null && m[1] !== undefined ? m[1] : v.stdout.trim();
    return { status: 'ok', detail: { version, absPath: w.path } };
  });
}

// --- claude.desktop ---------------------------------------------------------

async function probeClaudeDesktop(
  homedir: string,
): Promise<ProbeResult<ClaudeDesktopDetail>> {
  return timed('claude.desktop', async () => {
    const candidates: ReadonlyArray<{
      absPath: string;
      appPath: '/Applications' | '~/Applications';
    }> = [
      { absPath: '/Applications/Claude.app', appPath: '/Applications' },
      {
        absPath: join(homedir, 'Applications', 'Claude.app'),
        appPath: '~/Applications',
      },
    ];
    for (const c of candidates) {
      try {
        const s = await roStat(c.absPath);
        if (s.isDirectory()) {
          return {
            status: 'ok',
            detail: { absPath: c.absPath, appPath: c.appPath },
          };
        }
      } catch {
        // ENOENT for either candidate is expected; keep looking.
      }
    }
    return { status: 'missing' };
  });
}

// --- gws.clientSecret -------------------------------------------------------

interface ClientSecretFile {
  installed?: {
    project_id?: string;
    client_id?: string;
  };
}

async function probeClientSecret(
  homedir: string,
): Promise<ProbeResult<ClientSecretDetail>> {
  return timed('gws.clientSecret', async () => {
    // Honor CONCIERGE_TEST_GWS_DIR so the F2b shim's per-test client_secret.json
    // is observed by this probe under test.
    const envDir = process.env['CONCIERGE_TEST_GWS_DIR'];
    let raw: string | null;
    let absPath: string;
    if (envDir !== undefined) {
      absPath = join(envDir, 'client_secret.json');
      try {
        raw = await readFile(absPath, 'utf8');
      } catch {
        raw = null;
      }
    } else {
      absPath = join(homedir, '.config', 'gws', 'client_secret.json');
      raw = await readGwsClientSecret(homedir);
    }

    if (raw === null) return { status: 'missing' };

    let parsed: ClientSecretFile;
    try {
      parsed = JSON.parse(raw) as ClientSecretFile;
    } catch {
      return { status: 'broken' };
    }
    const projectId = parsed.installed?.project_id ?? '';
    const clientId = parsed.installed?.client_id ?? '';
    const numericPrefixMatch = /^(\d+)/.exec(clientId);
    const clientIdNumericPrefix =
      numericPrefixMatch !== null && numericPrefixMatch[1] !== undefined
        ? numericPrefixMatch[1]
        : '';
    const placeholderSuspect =
      projectId.length > 0 && PLACEHOLDER_PROJECT_ID_RE.test(projectId);
    return {
      status: projectId.length > 0 ? 'ok' : 'broken',
      detail: {
        path: absPath,
        projectId,
        placeholderSuspect,
        clientIdNumericPrefix,
      },
    };
  });
}

// --- gcp.apisEnabled --------------------------------------------------------

async function probeApisEnabled(
  csResult: ProbeResult<ClientSecretDetail>,
): Promise<ProbeResult<ApisEnabledDetail>> {
  return timed('gcp.apisEnabled', async () => {
    const projectId = csResult.detail?.projectId ?? '';
    if (csResult.status !== 'ok' || projectId.length === 0) {
      return { status: 'skipped' };
    }
    const w = await whichBin('gcloud');
    if (!w.found) return { status: 'skipped' };

    const v = await runCommand('gcloud', [
      'services',
      'list',
      '--enabled',
      `--project=${projectId}`,
      '--format=json',
    ]);
    if (v.code !== 0) {
      return {
        status: 'broken',
        detail: { project: projectId, enabled: [], missing: [] },
      };
    }

    let services: Array<{ config?: { name?: string } }>;
    try {
      services = JSON.parse(v.stdout) as Array<{
        config?: { name?: string };
      }>;
    } catch {
      return {
        status: 'broken',
        detail: { project: projectId, enabled: [], missing: [] },
      };
    }
    const enabledFull = services
      .map((s) => s.config?.name ?? '')
      .filter((s) => s.length > 0);
    const enabledShort = new Set(
      enabledFull.map((name) => name.replace(/\.googleapis\.com$/, '')),
    );
    const enabled = PRODUCTIVITY_APIS.filter((s) => enabledShort.has(s));
    const missing = PRODUCTIVITY_APIS.filter((s) => !enabledShort.has(s));
    return {
      status: missing.length === 0 ? 'ok' : 'stale',
      detail: {
        project: projectId,
        enabled,
        missing,
      },
    };
  });
}

// --- gws.authStatus ---------------------------------------------------------

interface AuthStatusJson {
  user?: string;
  scopes?: string[];
  token_valid?: boolean;
  project_id?: string;
}

async function probeAuthStatus(): Promise<ProbeResult<AuthStatusDetail>> {
  return timed('gws.authStatus', async () => {
    const bin = process.env['CONCIERGE_TEST_GWS_BIN'] ?? 'gws';
    const v = await runCommand(bin, ['auth', 'status']);
    // Real gws: exit 2 == not authenticated, exit 0 + JSON == authenticated.
    if (v.code === 2) return { status: 'missing' };
    if (v.code !== 0) return { status: 'broken' };
    let parsed: AuthStatusJson;
    try {
      parsed = JSON.parse(v.stdout) as AuthStatusJson;
    } catch {
      return { status: 'broken' };
    }
    const user = parsed.user ?? '';
    const projectId = parsed.project_id ?? '';
    const tokenValid = parsed.token_valid === true;
    const scopes = Array.isArray(parsed.scopes) ? parsed.scopes : [];
    if (user.length === 0 || !tokenValid) {
      return {
        status: 'broken',
        detail: { user, tokenValid, projectId, scopes },
      };
    }
    return {
      status: 'ok',
      detail: { user, tokenValid, projectId, scopes },
    };
  });
}

// --- account.domain (derived from gws.authStatus) ---------------------------

function deriveAccountDomain(
  authResult: ProbeResult<AuthStatusDetail>,
): ProbeResult<AccountDomainDetail> {
  const stamp = new Date().toISOString();
  if (authResult.status !== 'ok' || authResult.detail === undefined) {
    return {
      name: 'account.domain',
      status: 'skipped',
      durationMs: 0,
      timestamp: stamp,
    };
  }
  const user = authResult.detail.user;
  const at = user.lastIndexOf('@');
  if (at < 0 || at === user.length - 1) {
    return {
      name: 'account.domain',
      status: 'broken',
      durationMs: 0,
      timestamp: stamp,
    };
  }
  const domain = user.slice(at + 1).toLowerCase();
  const type: 'personal' | 'workspace' = PERSONAL_DOMAINS.has(domain)
    ? 'personal'
    : 'workspace';
  return {
    name: 'account.domain',
    status: 'ok',
    durationMs: 0,
    timestamp: stamp,
    detail: { user, domain, type },
  };
}

// --- mcpb.desktop -----------------------------------------------------------

async function probeMcpbDesktop(
  ctx: ProbeContext,
): Promise<ProbeResult<McpbDesktopDetail>> {
  return timed('mcpb.desktop', async () => {
    const path = ctx.unpackedDistIndexJsPath;
    const manifest = ctx.manifest;
    if (path === undefined || manifest === undefined) {
      return { status: 'skipped' };
    }
    let buf: Buffer;
    try {
      buf = await readFile(path);
    } catch {
      return { status: 'missing' };
    }
    const installedSha = createHash('sha256').update(buf).digest('hex');
    const bundledSha = manifest.bundledMcpb.sha256;
    const matches = installedSha === bundledSha;
    return {
      status: matches ? 'ok' : 'stale',
      detail: {
        unpackedPath: path,
        bundledSha,
        installedSha,
        namespace: manifest.bundledMcpb.namespace,
        matches,
      },
    };
  });
}

// --- mcpb.cli ---------------------------------------------------------------

async function probeMcpbCli(
  ctx: ProbeContext,
): Promise<ProbeResult<McpbCliDetail>> {
  return timed<McpbCliDetail>('mcpb.cli', async () => {
    const expected = ctx.claudeCliExpectedPath;
    if (expected === undefined) {
      return { status: 'skipped' };
    }
    const claudeJsonPath = join(ctx.homedir, '.claude.json');
    let state: Awaited<ReturnType<typeof probeClaudeRegistration>>;
    try {
      state = await probeClaudeRegistration(ctx.homedir, expected);
    } catch {
      return { status: 'broken' };
    }
    if (state.kind === 'absent') {
      return {
        status: 'missing',
        detail: {
          claudeJsonPath,
          registered: false,
          expectedAbsPath: expected,
          matches: false,
        },
      };
    }
    if (state.kind === 'no_concierge') {
      return {
        status: 'missing',
        detail: {
          claudeJsonPath,
          registered: false,
          expectedAbsPath: expected,
          matches: false,
        },
      };
    }
    const detail: McpbCliDetail = {
      claudeJsonPath,
      registered: true,
      expectedAbsPath: state.expectedAbsPath,
      actualAbsPath: state.actualAbsPath,
      matches: state.matches,
    };
    return {
      status: state.matches ? 'ok' : 'stale',
      detail,
    };
  });
}

// --- verify.endToEnd (placeholder; C6 owns the spawn check) -----------------

function makeVerifyPlaceholder(): ProbeResult<VerifyEndToEndDetail> {
  return {
    name: 'verify.endToEnd',
    status: 'skipped',
    durationMs: 0,
    timestamp: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

const PROBE_NAME_ORDER: readonly ProbeName[] = [
  'account.domain',
  'brew',
  'claude.cli',
  'claude.desktop',
  'gcloud',
  'gcloud.appDefault',
  'gcp.apisEnabled',
  'gws',
  'gws.authStatus',
  'gws.clientSecret',
  'gws.version',
  'mcpb.cli',
  'mcpb.desktop',
  'node',
  'verify.endToEnd',
];

/** Run all 15 probes in parallel and return them sorted by ProbeName for
 *  stable output. Composite gws probe runs once and yields two results. */
export async function runAllProbes(
  ctx: ProbeContext,
): Promise<readonly ProbeResult[]> {
  // Phase A: kick off all parallel-safe probes simultaneously. account.domain
  // and gcp.apisEnabled need other probe results, so they run after Phase A
  // settles — but everything else fans out at once.
  const [
    brew,
    node,
    gwsComposite,
    gcloud,
    gcloudAppDefault,
    claudeCli,
    claudeDesktop,
    clientSecret,
    authStatus,
    mcpbDesktop,
    mcpbCli,
  ] = await Promise.all([
    probeBrew(),
    probeNode(),
    probeGwsComposite(),
    probeGcloud(),
    probeGcloudAppDefault(),
    probeClaudeCli(),
    probeClaudeDesktop(ctx.homedir),
    probeClientSecret(ctx.homedir),
    probeAuthStatus(),
    probeMcpbDesktop(ctx),
    probeMcpbCli(ctx),
  ]);

  // Phase B: derive the two probes that depend on Phase A results.
  const apisEnabled = await probeApisEnabled(clientSecret);
  const accountDomain = deriveAccountDomain(authStatus);
  const verifyPlaceholder = makeVerifyPlaceholder();

  const all: ProbeResult[] = [
    brew,
    node,
    gwsComposite.gws,
    gwsComposite.gwsVersion,
    gcloud,
    gcloudAppDefault,
    claudeCli,
    claudeDesktop,
    clientSecret,
    apisEnabled,
    authStatus,
    accountDomain,
    mcpbDesktop,
    mcpbCli,
    verifyPlaceholder,
  ];

  // Stable-sort by ProbeName so the consent reducer + diagnose output get
  // deterministic ordering regardless of which probe finished first.
  const orderIdx = new Map<ProbeName, number>(
    PROBE_NAME_ORDER.map((n, i) => [n, i]),
  );
  return [...all].sort(
    (a, b) =>
      (orderIdx.get(a.name) ?? 0) - (orderIdx.get(b.name) ?? 0),
  );
}
