// Tests for C8: phases/diagnose.ts.
//
// Strategy:
//   - Real fs (tempdirs under os.tmpdir()) for log files, ~/.claude.json,
//     bundle output, and a fake "Claude.app" directory.
//   - Real `gws` shim (tests/fixtures/bin/gws) for the gws auth status path.
//   - For other CLIs (brew, node, gcloud, claude) we steer via
//     CONCIERGE_TEST_<TOOL>_BIN env vars, pointed at either /usr/bin/false
//     (simulate "not installed" — execFile returns exit 1, we render
//     [not installed] markers via runCaptureFirstLine returning null)
//     or /usr/bin/true (simulate "present, no output").
//
// D17 invariant test: a fixture log line containing
//   "refresh_token": "1//0gREALSECRET..."
// must be redacted in BOTH default AND --full mode. The hard-list pass
// runs unconditionally.

import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runDiagnose } from '../../src/phases/diagnose.js';

const execFileP = promisify(execFile);

const SHIM_GWS = resolve(__dirname, '../../../../tests/fixtures/bin/gws');

let scratch: string;
let homedir: string;
let logsDir: string;
let outputDir: string;
let savedEnv: Record<string, string | undefined> = {};

const ENV_KEYS = [
  'CONCIERGE_TEST_GWS_BIN',
  'CONCIERGE_TEST_GWS_DIR',
  'CONCIERGE_TEST_GWS_USER',
  'CONCIERGE_TEST_BREW_BIN',
  'CONCIERGE_TEST_NODE_BIN',
  'CONCIERGE_TEST_GCLOUD_BIN',
  'CONCIERGE_TEST_CLAUDE_BIN',
] as const;

function saveEnv(): void {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
}

function restoreEnv(): void {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'concierge-diagnose-test-'));
  homedir = join(scratch, 'home');
  logsDir = join(scratch, 'logs');
  outputDir = join(scratch, 'out');
  await mkdir(homedir, { recursive: true });
  await mkdir(logsDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  saveEnv();

  // Default: every CLI "not installed" except as overridden per-test.
  // /usr/bin/false exits 1 — runCaptureFirstLine returns null,
  // commandExists() returns true (any non-ENOENT). For diagnose's
  // "[not installed]" Versions line we want runCaptureFirstLine -> null,
  // which the false binary delivers.
  process.env['CONCIERGE_TEST_BREW_BIN'] = '/usr/bin/false';
  process.env['CONCIERGE_TEST_NODE_BIN'] = '/usr/bin/false';
  process.env['CONCIERGE_TEST_GCLOUD_BIN'] = '/usr/bin/false';
  // Claude defaults to NOT installed via a name that resolves to ENOENT.
  process.env['CONCIERGE_TEST_CLAUDE_BIN'] = '/this/path/does/not/exist/claude';
  // gws also defaults to absent (ENOENT).
  process.env['CONCIERGE_TEST_GWS_BIN'] = '/this/path/does/not/exist/gws';
});

afterEach(async () => {
  restoreEnv();
  await rm(scratch, { recursive: true, force: true });
});

/** Seed a setup-*.log with the supplied line objects under logsDir. */
async function seedLog(filename: string, lines: object[]): Promise<string> {
  const full = join(logsDir, filename);
  const body = lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
  await writeFile(full, body);
  return full;
}

/** Seed a ~/.claude.json under the injected homedir. */
async function seedClaudeJson(parsed: object): Promise<void> {
  await writeFile(join(homedir, '.claude.json'), JSON.stringify(parsed));
}

/** Configure the gws shim env so `gws auth status` returns a fixture body. */
async function configureGwsShim(user: string): Promise<string> {
  const gwsDir = join(scratch, 'gws');
  await mkdir(gwsDir, { recursive: true });
  process.env['CONCIERGE_TEST_GWS_BIN'] = SHIM_GWS;
  process.env['CONCIERGE_TEST_GWS_DIR'] = gwsDir;
  process.env['CONCIERGE_TEST_GWS_USER'] = user;
  // Trigger the shim's setup + login so auth-status.json exists.
  await execFileP(SHIM_GWS, ['auth', 'setup'], {
    env: { ...process.env, CONCIERGE_TEST_GWS_DIR: gwsDir },
  });
  await execFileP(
    SHIM_GWS,
    ['auth', 'login', '--services', 'gmail,drive'],
    {
      env: {
        ...process.env,
        CONCIERGE_TEST_GWS_DIR: gwsDir,
        CONCIERGE_TEST_GWS_USER: user,
      },
    },
  );
  return gwsDir;
}

describe('runDiagnose — text mode', () => {
  it('renders all sections when nothing is installed (N10: explicit [not installed] markers)', async () => {
    const result = await runDiagnose({
      mode: 'text',
      full: false,
      homedir,
      logsDir,
    });

    expect(result.mode).toBe('text');
    // Every section heading must be present.
    for (const heading of [
      '## Concierge',
      '## Versions',
      '## Last Setup Log (tail 200)',
      '## gws auth status',
      '## gcloud config',
      '## Claude Desktop',
      '## Claude CLI',
    ]) {
      expect(result.output).toContain(heading);
    }
    // Versions section: every tool flagged [not installed] (false exits 1).
    expect(result.output).toMatch(/brew: \[not installed\]/);
    expect(result.output).toMatch(/node: \[not installed\]/);
    // gws absent → [not installed].
    expect(result.output).toContain('[not installed]');
    // No actual log written → [no logs].
    expect(result.output).toContain('[no logs]');
    // sections array reports every section.
    expect(result.sections.length).toBe(7);
  });

  it('default mode redacts emails + filesystem usernames (PII pass active)', async () => {
    await seedLog('setup-2026-04-25T00-00-00.000Z.log', [
      {
        ts: '2026-04-25T00:00:00Z',
        phase: 'oauth',
        level: 'info',
        msg: 'authenticated alice@acme.com from /Users/alicebob/Projects',
        schemaVersion: 1,
      },
    ]);

    const result = await runDiagnose({
      mode: 'text',
      full: false,
      homedir,
      logsDir,
    });

    expect(result.output).not.toContain('alice@acme.com');
    expect(result.output).toContain('[email]');
    expect(result.output).not.toContain('/Users/alicebob/');
    // fs-username pattern replaces with /Users/~/
    expect(result.output).toContain('/Users/~/');
  });

  it('--full mode preserves filesystem usernames + emails (PII pass skipped)', async () => {
    await seedLog('setup-2026-04-25T00-00-00.000Z.log', [
      {
        ts: '2026-04-25T00:00:00Z',
        phase: 'oauth',
        level: 'info',
        msg: 'authenticated alice@acme.com from /Users/alicebob/Projects',
        schemaVersion: 1,
      },
    ]);

    const result = await runDiagnose({
      mode: 'text',
      full: true,
      homedir,
      logsDir,
    });

    // Both PII tokens survive the --full pass.
    expect(result.output).toContain('alice@acme.com');
    expect(result.output).toContain('/Users/alicebob/');
  });

  it('D17 hard-list: refresh_token / client_secret / access_token / id_token bodies are STILL redacted under --full', async () => {
    await seedLog('setup-2026-04-25T00-00-00.000Z.log', [
      {
        ts: '2026-04-25T00:00:00Z',
        phase: 'oauth',
        level: 'error',
        msg:
          'token leak: "refresh_token": "1//0gREALSECRET-xyz" "client_secret": "GOCSPX-LEAKEDvalue" "access_token": "ya29.LEAKaccess" "id_token": "eyJhbGciOi.eyJzdWIiOi.SIGabc"',
        schemaVersion: 1,
      },
    ]);

    const full = await runDiagnose({
      mode: 'text',
      full: true,
      homedir,
      logsDir,
    });

    // None of the secret bodies should survive.
    expect(full.output).not.toContain('1//0gREALSECRET-xyz');
    expect(full.output).not.toContain('GOCSPX-LEAKEDvalue');
    expect(full.output).not.toContain('ya29.LEAKaccess');
    expect(full.output).not.toContain('eyJhbGciOi.eyJzdWIiOi.SIGabc');
    // [REDACTED] markers should appear.
    expect(full.output).toContain('[REDACTED]');

    // And the same is true in default mode.
    const def = await runDiagnose({
      mode: 'text',
      full: false,
      homedir,
      logsDir,
    });
    expect(def.output).not.toContain('1//0gREALSECRET-xyz');
    expect(def.output).not.toContain('GOCSPX-LEAKEDvalue');
    expect(def.output).not.toContain('ya29.LEAKaccess');
  });

  it('Claude Desktop missing → [not installed] section, no error', async () => {
    // Default beforeEach already ensures Claude Desktop is not detected
    // (we do NOT create /Applications/Claude.app or ~/Applications/Claude.app
    // under the injected homedir). Pass an explicit absent path to also
    // bypass any stray system Claude.app at /Applications.
    const result = await runDiagnose({
      mode: 'text',
      full: false,
      homedir,
      logsDir,
      claudeDesktopAppPath: join(scratch, 'no-such-Claude.app'),
    });

    const desktopSection = result.sections.find(
      (s) => s.name === 'Claude Desktop',
    );
    expect(desktopSection?.status).toBe('not-installed');
    // Section body shows the marker exactly once under its heading.
    expect(result.output).toMatch(/## Claude Desktop\n\n\[not installed\]/);
  });

  it('Claude CLI missing → [not installed] section', async () => {
    const result = await runDiagnose({
      mode: 'text',
      full: false,
      homedir,
      logsDir,
    });
    const cliSection = result.sections.find((s) => s.name === 'Claude CLI');
    expect(cliSection?.status).toBe('not-installed');
    expect(result.output).toMatch(/## Claude CLI\n\n\[not installed\]/);
  });

  it('Logs dir empty → [no logs] under Last Setup Log', async () => {
    const result = await runDiagnose({
      mode: 'text',
      full: false,
      homedir,
      logsDir,
    });
    const sec = result.sections.find((s) => s.name === 'Last Setup Log');
    expect(sec?.status).toBe('not-installed');
    expect(result.output).toContain('[no logs]');
  });

  it('Logs dir missing entirely → [no logs]', async () => {
    const result = await runDiagnose({
      mode: 'text',
      full: false,
      homedir,
      logsDir: join(scratch, 'nonexistent-logs'),
    });
    expect(result.output).toContain('[no logs]');
  });

  it('Last Setup Log tail caps at 200 lines', async () => {
    const lines: object[] = [];
    for (let i = 0; i < 250; i += 1) {
      lines.push({
        ts: `2026-04-25T00:00:${String(i % 60).padStart(2, '0')}Z`,
        phase: 'probe',
        level: 'info',
        msg: `line-${String(i)}`,
        schemaVersion: 1,
      });
    }
    await seedLog('setup-2026-04-25T00-00-00.000Z.log', lines);

    const result = await runDiagnose({
      mode: 'text',
      full: false,
      homedir,
      logsDir,
    });
    // We dropped the first 50 lines; line-0 through line-49 should be gone.
    expect(result.output).not.toContain('"line-0"');
    expect(result.output).not.toContain('"line-49"');
    expect(result.output).toContain('"line-50"');
    expect(result.output).toContain('"line-249"');
  });

  it('gws auth status (authenticated) renders fenced JSON with [email] redacted', async () => {
    await configureGwsShim('alice@gmail.com');

    const result = await runDiagnose({
      mode: 'text',
      full: false,
      homedir,
      logsDir,
    });

    expect(result.output).toMatch(/## gws auth status\n\n```json/);
    // Default mode redacts the email PII.
    expect(result.output).not.toContain('alice@gmail.com');
    expect(result.output).toContain('[email]');
    // Hard-list still applies (no token bodies in fixture, but the structure
    // should round-trip the user/scopes shape).
    expect(result.output).toContain('"scopes"');
  });

  it('gws auth status under --full preserves the email but still redacts hard-list tokens if present', async () => {
    await configureGwsShim('alice@gmail.com');

    const result = await runDiagnose({
      mode: 'text',
      full: true,
      homedir,
      logsDir,
    });
    expect(result.output).toContain('alice@gmail.com');
  });
});

describe('runDiagnose — bundle mode', () => {
  it('writes a tarball to outputDir whose contents match the text-mode rendering', async () => {
    const ts = new Date('2026-04-25T12:00:00.000Z');
    const stamp = ts.toISOString().replace(/:/g, '-');
    const expectedPath = join(
      outputDir,
      `concierge-diagnose-${stamp}.tar.gz`,
    );

    const result = await runDiagnose({
      mode: 'bundle',
      full: false,
      homedir,
      logsDir,
      outputDir,
      timestamp: ts,
    });

    expect(result.mode).toBe('bundle');
    expect(result.output).toBe(expectedPath);

    // List the tarball contents.
    const { stdout: listing } = await execFileP('tar', [
      '-tzf',
      expectedPath,
    ]);
    expect(listing.trim()).toBe(`concierge-diagnose-${stamp}.txt`);

    // Extract + diff against the same options rendered as text.
    const extractDir = await mkdtemp(join(tmpdir(), 'diagnose-extract-'));
    try {
      await execFileP('tar', ['-xzf', expectedPath, '-C', extractDir]);
      const extracted = await import('node:fs/promises').then((fs) =>
        fs.readFile(
          join(extractDir, `concierge-diagnose-${stamp}.txt`),
          'utf8',
        ),
      );
      const textOnly = await runDiagnose({
        mode: 'text',
        full: false,
        homedir,
        logsDir,
      });
      expect(extracted).toBe(textOnly.output);
    } finally {
      await rm(extractDir, { recursive: true, force: true });
    }
  });

  it('--full bundle filename includes the -full suffix (visual safety flag)', async () => {
    const ts = new Date('2026-04-25T12:00:00.000Z');
    const stamp = ts.toISOString().replace(/:/g, '-');
    const expectedPath = join(
      outputDir,
      `concierge-diagnose-${stamp}-full.tar.gz`,
    );

    const result = await runDiagnose({
      mode: 'bundle',
      full: true,
      homedir,
      logsDir,
      outputDir,
      timestamp: ts,
    });

    expect(result.output).toBe(expectedPath);
    const { stdout: listing } = await execFileP('tar', [
      '-tzf',
      expectedPath,
    ]);
    expect(listing.trim()).toBe(`concierge-diagnose-${stamp}-full.txt`);
  });
});

describe('runDiagnose — Claude CLI registered', () => {
  it('extracts mcpServers.concierge entry from ~/.claude.json when CLI present', async () => {
    process.env['CONCIERGE_TEST_CLAUDE_BIN'] = '/usr/bin/true';
    await seedClaudeJson({
      mcpServers: {
        concierge: {
          type: 'stdio',
          command: 'node',
          args: ['/Users/alice/.local/share/concierge/mcpb/0.2.0/dist/index.js'],
          scope: 'user',
        },
        unrelated: { type: 'stdio', command: 'other' },
      },
    });

    const result = await runDiagnose({
      mode: 'text',
      full: false,
      homedir,
      logsDir,
    });
    const sec = result.sections.find((s) => s.name === 'Claude CLI');
    expect(sec?.status).toBe('included');
    // Default mode should redact the fs username in the args path.
    expect(result.output).not.toContain('/Users/alice/.local');
    expect(result.output).toContain('/Users/~/');
    // The unrelated server entry should not leak.
    expect(result.output).not.toContain('unrelated');
    // The concierge entry should be JSON-fenced.
    expect(result.output).toMatch(/## Claude CLI\n\n```json/);
  });
});
