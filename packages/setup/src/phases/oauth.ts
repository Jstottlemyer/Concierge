// C4: OAuth phase — wraps `gws auth setup` (interactive, creates GCP project +
// downloads client_secret.json) and `gws auth login` (browser-based OAuth that
// binds an ephemeral local port for the redirect).
//
// Two non-trivial bits this module owns:
//
//   1. Port-collision detection (N4). gws picks an ephemeral port we cannot
//      pre-probe. When it fails to bind we get a stderr line like
//        `error: bind: address already in use (port 8080)`
//      We stream stderr line-by-line, watch for that pattern, and if seen we
//      SIGTERM the child early and surface `kind: 'port_collision'` so the
//      orchestrator can recover (kill whoever's on that port + retry) without
//      waiting on the OAuth dance to time out.
//
//   2. Domain-mismatch detection. The orchestrator asks the user up front
//      whether they're using a personal Gmail or a Workspace account; if the
//      account they OAuth'd as doesn't match (e.g. they declared workspace and
//      then signed in with a personal gmail.com) we surface
//      `kind: 'account_mismatch'` rather than letting the user discover the
//      misconfiguration later via 403s on Workspace-only Admin APIs.
//
// `runGwsAuthSetup` is interactive — gws prompts the user through a wizard.
// We spawn with `stdio: inherit` so the user can interact with the terminal,
// then read back the resulting `client_secret.json` and inspect `project_id`
// for the placeholder pattern (CLAUDE.md: `authtools-spike` is the canonical
// example of this footgun).

import { spawn, execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

export type AccountType = 'personal' | 'workspace';

export interface OauthSetupOptions {
  /** Suggested Project ID; user can override during gws prompt. */
  suggestedProjectId: string;
  /** For prompt UX rendering; not consumed by gws. */
  accountType: AccountType;
}

export interface OauthLoginOptions {
  services: readonly string[];
  /** Expected account type for domain-mismatch detection. */
  expectedAccountType: AccountType;
  /** Optional cap on how long we wait for `gws auth login` to complete.
   *  Default: undefined (wait indefinitely; user closes the browser to cancel). */
  timeoutMs?: number;
}

export type OauthSetupResult =
  | { kind: 'ok'; projectId: string }
  | { kind: 'placeholder_project_id'; suspectedProjectId: string }
  | { kind: 'gws_punted'; helpText: string }
  | { kind: 'subprocess_failed'; exitCode: number; stderr: string };

export type OauthLoginResult =
  | { kind: 'ok'; user: string; tokenValid: true; scopes: readonly string[] }
  | { kind: 'port_collision'; port: number; rawStderrLine: string }
  | {
      kind: 'account_mismatch';
      userDomain: string;
      expectedType: AccountType;
      actualType: AccountType;
    }
  | { kind: 'oauth_browser_failed'; stderr: string }
  | { kind: 'subprocess_failed'; exitCode: number; stderr: string };

/** Domains we treat as "personal Gmail" — case-insensitive. Everything else is
 *  a Google Workspace custom domain. (`googlemail.com` is the legacy German /
 *  UK alias for gmail.com.) */
const PERSONAL_DOMAINS: ReadonlySet<string> = new Set(['gmail.com', 'googlemail.com']);

/** Heuristic for detecting "I just clicked through the wizard with whatever
 *  default name was in the field" Project IDs that look like setup-tutorial
 *  placeholders rather than real Cloud Project IDs. CLAUDE.md captures the
 *  canonical case (`authtools-spike`) — match those families before letting a
 *  user proceed and discover the project doesn't exist later. */
const PLACEHOLDER_PROJECT_ID_RE =
  /^(authtools|concierge)-(?:spike|test|placeholder|example|sample|demo)$/i;

/** Stderr signature that indicates gws was unable to bind to its OAuth
 *  redirect port. Captures the port number when present. */
const PORT_COLLISION_RE =
  /bind:\s*address already in use(?:[^\d]*\(?\s*port\s*(\d+)\)?)?/i;

/** Resolve the gws binary path: honour the test-injected override first so the
 *  fixture shim can be substituted, otherwise fall back to PATH lookup. */
function resolveGwsBin(): string {
  return process.env['CONCIERGE_TEST_GWS_BIN'] ?? 'gws';
}

/** Resolve where `gws auth setup` will have written `client_secret.json`. In
 *  tests we steer the shim with `CONCIERGE_TEST_GWS_DIR` so we can scrub
 *  state per-test without ever touching `~/.config/gws/`. */
function resolveGwsConfigDir(): string {
  return process.env['CONCIERGE_TEST_GWS_DIR'] ?? join(homedir(), '.config', 'gws');
}

/** Classify an email address as personal-Gmail vs Workspace-domain. Empty /
 *  malformed inputs are treated as Workspace (the conservative default — we'd
 *  rather surface a mismatch than silently proceed). */
export function classifyAccountDomain(userEmail: string): AccountType {
  const at = userEmail.lastIndexOf('@');
  if (at < 0 || at === userEmail.length - 1) return 'workspace';
  const domain = userEmail.slice(at + 1).toLowerCase();
  return PERSONAL_DOMAINS.has(domain) ? 'personal' : 'workspace';
}

interface ClientSecretFile {
  installed?: { project_id?: string };
}

interface AuthStatus {
  user?: string;
  scopes?: string[];
  token_valid?: boolean;
  project_id?: string;
}

/**
 * Run `gws auth setup` interactively. The user drives a wizard inside their
 * own terminal; we observe exit code + read back the resulting
 * `client_secret.json` to extract the project_id, classify whether it's a
 * placeholder, and surface the result.
 */
export async function runGwsAuthSetup(_options: OauthSetupOptions): Promise<OauthSetupResult> {
  // _options is reserved for future prompt-templating; gws owns the wizard
  // flow and we cannot inject the suggested project id directly today.
  void _options;
  const bin = resolveGwsBin();

  // Capture stderr for "punt" detection while still letting the user interact
  // with the terminal. We pass stdin/stdout as inherit and pipe stderr; gws
  // writes prompts to stdout and only diagnostic output to stderr, so the user
  // experience is unaffected.
  const stderrBuf: string[] = [];
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(bin, ['auth', 'setup'], {
      stdio: ['inherit', 'inherit', 'pipe'],
      shell: false,
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrBuf.push(chunk.toString('utf8'));
    });
    child.on('error', (err) => {
      reject(err);
    });
    child.on('close', (code) => {
      resolve(code ?? -1);
    });
  });

  const stderr = stderrBuf.join('');

  if (exitCode !== 0) {
    // Heuristic: when gws can't auto-create the OAuth client (often because
    // the user's account lacks Cloud Resource Manager perms), it dumps a
    // help-text wall instructing manual Cloud Console steps. Distinguish that
    // case from generic spawn failure so the orchestrator can render the
    // user-facing fallback path rather than a raw stderr blob.
    if (/oauth client|cloud console|manual/i.test(stderr)) {
      return { kind: 'gws_punted', helpText: stderr.trim() };
    }
    return { kind: 'subprocess_failed', exitCode, stderr };
  }

  // Read back the project_id gws just wrote.
  const csPath = join(resolveGwsConfigDir(), 'client_secret.json');
  let parsed: ClientSecretFile;
  try {
    const raw = await readFile(csPath, 'utf8');
    parsed = JSON.parse(raw) as ClientSecretFile;
  } catch (err) {
    return {
      kind: 'subprocess_failed',
      exitCode: 0,
      stderr: `gws auth setup exited 0 but client_secret.json unreadable: ${
        (err as Error).message
      }`,
    };
  }

  const projectId = parsed.installed?.project_id ?? '';
  if (projectId.length === 0) {
    return {
      kind: 'subprocess_failed',
      exitCode: 0,
      stderr: 'client_secret.json missing installed.project_id',
    };
  }
  if (PLACEHOLDER_PROJECT_ID_RE.test(projectId)) {
    return { kind: 'placeholder_project_id', suspectedProjectId: projectId };
  }
  return { kind: 'ok', projectId };
}

/**
 * Run `gws auth login --services <csv>`. Streams stderr line-by-line so we
 * can detect the port-collision case before gws gives up on its own. On
 * success, calls `gws auth status` to extract the user email + scopes, then
 * cross-checks the email's domain against the orchestrator-declared account
 * type.
 */
export async function runGwsAuthLogin(options: OauthLoginOptions): Promise<OauthLoginResult> {
  const bin = resolveGwsBin();
  const servicesCsv = options.services.join(',');

  const portCollisionState = await spawnGwsAuthLogin(bin, servicesCsv, options.timeoutMs);

  if (portCollisionState.kind === 'port_collision') {
    return portCollisionState;
  }
  if (portCollisionState.kind === 'failed') {
    const { exitCode, stderr } = portCollisionState;
    // Browser-launch failures carry a recognizable signature; surface a
    // dedicated kind so the orchestrator can prompt the user to copy the URL
    // manually rather than blaming gws.
    if (/cannot open browser|xdg-open|failed to launch browser/i.test(stderr)) {
      return { kind: 'oauth_browser_failed', stderr };
    }
    return { kind: 'subprocess_failed', exitCode, stderr };
  }

  // Success path: read back `gws auth status`. Use execFile here — it's a
  // one-shot read of a JSON document, no streaming required.
  let status: AuthStatus;
  try {
    status = await runGwsAuthStatus(bin);
  } catch (err) {
    return {
      kind: 'subprocess_failed',
      exitCode: -1,
      stderr: `gws auth status failed after successful login: ${(err as Error).message}`,
    };
  }

  const user = status.user ?? '';
  const scopes = status.scopes ?? [];
  if (user.length === 0 || status.token_valid !== true) {
    return {
      kind: 'subprocess_failed',
      exitCode: 0,
      stderr: 'gws auth status returned without a valid token after login',
    };
  }

  const actualType = classifyAccountDomain(user);
  if (actualType !== options.expectedAccountType) {
    const at = user.lastIndexOf('@');
    const userDomain = at >= 0 ? user.slice(at + 1) : user;
    return {
      kind: 'account_mismatch',
      userDomain,
      expectedType: options.expectedAccountType,
      actualType,
    };
  }

  return { kind: 'ok', user, tokenValid: true, scopes };
}

interface SpawnOk {
  kind: 'ok';
}
interface SpawnFailed {
  kind: 'failed';
  exitCode: number;
  stderr: string;
}
interface SpawnPortCollision {
  kind: 'port_collision';
  port: number;
  rawStderrLine: string;
}

async function spawnGwsAuthLogin(
  bin: string,
  servicesCsv: string,
  timeoutMs: number | undefined,
): Promise<SpawnOk | SpawnFailed | SpawnPortCollision> {
  return new Promise((resolve) => {
    const stderrBuf: string[] = [];
    let lineCarry = '';
    let earlyExit: SpawnPortCollision | null = null;
    let settled = false;
    let timeoutHandle: NodeJS.Timeout | null = null;

    const child = spawn(bin, ['auth', 'login', '--services', servicesCsv], {
      stdio: ['inherit', 'inherit', 'pipe'],
      shell: false,
    });

    const settle = (result: SpawnOk | SpawnFailed | SpawnPortCollision): void => {
      if (settled) return;
      settled = true;
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
      resolve(result);
    };

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stderrBuf.push(text);
      // Process line-by-line so the port-collision regex sees a complete line.
      lineCarry += text;
      const lines = lineCarry.split(/\r?\n/);
      lineCarry = lines.pop() ?? '';
      for (const line of lines) {
        const m = PORT_COLLISION_RE.exec(line);
        if (m !== null && earlyExit === null) {
          const port = m[1] !== undefined ? Number.parseInt(m[1], 10) : 0;
          earlyExit = {
            kind: 'port_collision',
            port: Number.isFinite(port) ? port : 0,
            rawStderrLine: line.trim(),
          };
          // Kill the child so the orchestrator isn't blocked on the OAuth
          // wait. The 'close' handler will pick up earlyExit.
          try {
            child.kill('SIGTERM');
          } catch {
            // best-effort
          }
        }
      }
    });

    if (timeoutMs !== undefined) {
      timeoutHandle = setTimeout(() => {
        try {
          child.kill('SIGTERM');
        } catch {
          // best-effort
        }
        settle({
          kind: 'failed',
          exitCode: -1,
          stderr: `gws auth login exceeded timeout of ${String(timeoutMs)}ms`,
        });
      }, timeoutMs);
    }

    child.on('error', (err) => {
      settle({ kind: 'failed', exitCode: -1, stderr: (err as Error).message });
    });

    child.on('close', (code) => {
      // Port-collision wins regardless of how the child happened to exit.
      if (earlyExit !== null) {
        settle(earlyExit);
        return;
      }
      // Drain any trailing carry through the regex one more time so a
      // collision line that arrives without a trailing newline still
      // surfaces.
      if (lineCarry.length > 0) {
        const m = PORT_COLLISION_RE.exec(lineCarry);
        if (m !== null) {
          const port = m[1] !== undefined ? Number.parseInt(m[1], 10) : 0;
          settle({
            kind: 'port_collision',
            port: Number.isFinite(port) ? port : 0,
            rawStderrLine: lineCarry.trim(),
          });
          return;
        }
      }
      const stderr = stderrBuf.join('');
      if (code === 0) {
        settle({ kind: 'ok' });
      } else {
        settle({ kind: 'failed', exitCode: code ?? -1, stderr });
      }
    });
  });
}

async function runGwsAuthStatus(bin: string): Promise<AuthStatus> {
  return new Promise((resolve, reject) => {
    execFile(bin, ['auth', 'status'], { encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err !== null) {
        reject(new Error(`gws auth status failed: ${stderr || err.message}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as AuthStatus);
      } catch (parseErr) {
        reject(new Error(`gws auth status produced non-JSON output: ${(parseErr as Error).message}`));
      }
    });
  });
}
