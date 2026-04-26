// C8: --diagnose phase. Produces a redacted bundle for "send me your output"
// support requests in three modes:
//
//   1. Default (text):     markdown to stdout, redacted via `redactStringForLog`
//                          (HARD_LIST + PII patterns).
//   2. `--bundle`:         identical text written to a tarball at
//                          ~/Desktop/concierge-diagnose-<timestamp>.tar.gz.
//   3. `--full`:           opt-in. Skips PII patterns (filesystem usernames,
//                          GCP project numbers, JWT claim values, emails) so
//                          support has the data needed to triage. The hard
//                          list (refresh_token / client_secret / access_token /
//                          id_token bodies + Google `ya29.` / `1//` / `GOCSPX-`
//                          prefixed tokens + JWT triple-dot) STILL applies
//                          unconditionally — that is the D17 contract.
//
// Per N10: missing optional surfaces (Claude Desktop, Claude CLI) are
// included as a `[not installed]` marker rather than omitted, so the support
// reader can immediately tell the difference between "absent" and "diagnose
// crashed before that section".
//
// Redaction strategy chosen for `--full`:
//   - Default mode uses `redactStringForLog` (HARD_LIST + PII).
//   - Full mode uses `redactString`        (HARD_LIST only).
//   Because both pull from the same `HARD_LIST_PATTERNS` array exported by
//   `@concierge/core/log`, the spec D17 invariant ("never emit refresh_token /
//   client_secret / access_token / id_token bodies even with --full") is
//   structurally guaranteed without a parallel codepath. The only delta is
//   whether `PII_PATTERNS` runs after.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { homedir as osHomedir, tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { promisify } from 'node:util';

import { redactString, redactStringForLog } from '@concierge/core/log';

import {
  readClaudeJson,
  statClaudeExtensionDir,
} from '../io/readonly.js';

const execFileP = promisify(execFile);

// --- public surface ----------------------------------------------------------

export type DiagnoseMode = 'text' | 'bundle';

export interface DiagnoseOptions {
  mode: DiagnoseMode;
  /** Opt-in: skip PII redaction (still hard-redacts credential bodies). */
  full: boolean;
  /** Homedir (defaults to os.homedir() in production; tests inject). */
  homedir: string;
  /** Logs dir (defaults to <homedir>/.config/concierge/setup-logs/). */
  logsDir?: string;
  /** Bundle mode: where to write the tarball. Defaults to <homedir>/Desktop. */
  outputDir?: string;
  /** Bundle mode: timestamp baked into the filename. Defaults to new Date(). */
  timestamp?: Date;
  /**
   * Optional override for the `~/Library/Application Support/Claude` probe
   * namespace. In production this is read from the embedded manifest; tests
   * inject it directly. Defaults to a sentinel that will resolve to
   * "[not installed]" — sufficient for unit tests that just need a stable shape.
   */
  claudeExtensionNamespace?: string;
  /**
   * Optional override for the Claude Desktop app probe path. Tests can point
   * this at a tempdir-scoped fixture; production omits it (we then check
   * /Applications/Claude.app and ~/Applications/Claude.app).
   */
  claudeDesktopAppPath?: string;
}

export type SectionStatus = 'included' | 'not-installed' | 'error';

export interface DiagnoseSection {
  name: string;
  status: SectionStatus;
}

export interface DiagnoseResult {
  mode: DiagnoseMode;
  /** Text mode: rendered string. Bundle mode: absolute path to the tarball. */
  output: string;
  sections: readonly DiagnoseSection[];
}

// --- entrypoint --------------------------------------------------------------

export async function runDiagnose(
  options: DiagnoseOptions,
): Promise<DiagnoseResult> {
  const sections: DiagnoseSection[] = [];
  const parts: string[] = [];

  // The redactor we apply to every section body. Hard-list always runs;
  // PII patterns only when not --full.
  const redact = options.full ? redactString : redactStringForLog;

  // ## Concierge — version + build_id from embedded manifest if loadable.
  parts.push(await renderConciergeSection(options, redact, sections));

  // ## Versions — brew / node / gws / gcloud / claude.
  parts.push(await renderVersionsSection(redact, sections));

  // ## Last Setup Log (tail 200)
  parts.push(await renderLastLogSection(options, redact, sections));

  // ## gws auth status
  parts.push(await renderGwsAuthStatusSection(redact, sections));

  // ## gcloud config
  parts.push(await renderGcloudConfigSection(redact, sections));

  // ## Claude Desktop
  parts.push(await renderClaudeDesktopSection(options, redact, sections));

  // ## Claude CLI
  parts.push(await renderClaudeCliSection(options, redact, sections));

  const text = parts.join('\n\n') + '\n';

  if (options.mode === 'text') {
    return { mode: 'text', output: text, sections };
  }

  // Bundle mode.
  const tarballPath = await writeBundle(text, options);
  return { mode: 'bundle', output: tarballPath, sections };
}

// --- section renderers -------------------------------------------------------

type Redactor = (s: string) => string;

async function renderConciergeSection(
  options: DiagnoseOptions,
  redact: Redactor,
  sections: DiagnoseSection[],
): Promise<string> {
  // Embedded manifest is best-effort: if not loadable, we still render the
  // section with `[unknown]` markers (status: 'included' — the section is
  // present, just sparse).
  let version = '[unknown]';
  let buildId = '[unknown]';
  try {
    const m = await tryLoadManifest(options.homedir);
    if (m !== null) {
      version = m.setupVersion;
      buildId = m.bundledMcpb.buildId;
    }
  } catch {
    // swallow: status stays 'included' with [unknown] markers.
  }
  sections.push({ name: 'Concierge', status: 'included' });
  const body = [
    `version: ${version}`,
    `build_id: ${buildId}`,
  ].join('\n');
  return `## Concierge\n\n${redact(body)}`;
}

interface SetupManifestLite {
  setupVersion: string;
  bundledMcpb: { buildId: string };
}

async function tryLoadManifest(
  _homedir: string,
): Promise<SetupManifestLite | null> {
  // The embedded manifest path is build-time injected; for v0 we treat
  // absence as "[unknown]". Future: wire in `@concierge/setup`'s manifest
  // loader once the asset path resolution lands in B2's caller. Keeping the
  // seam here so the diagnose section header doesn't need to change later.
  return null;
}

async function renderVersionsSection(
  redact: Redactor,
  sections: DiagnoseSection[],
): Promise<string> {
  const tools: ReadonlyArray<{ tool: string; argv: readonly string[] }> = [
    { tool: 'brew', argv: ['--version'] },
    { tool: 'node', argv: ['--version'] },
    { tool: 'gws', argv: ['--version'] },
    { tool: 'gcloud', argv: ['--version'] },
    { tool: 'claude', argv: ['--version'] },
  ];
  const lines: string[] = [];
  for (const { tool, argv } of tools) {
    const v = await runCaptureFirstLine(resolveBin(tool), argv);
    if (v === null) {
      lines.push(`${tool}: [not installed]`);
    } else {
      lines.push(`${tool}: ${v}`);
    }
  }
  sections.push({ name: 'Versions', status: 'included' });
  return `## Versions\n\n${redact(lines.join('\n'))}`;
}

async function renderLastLogSection(
  options: DiagnoseOptions,
  redact: Redactor,
  sections: DiagnoseSection[],
): Promise<string> {
  const logsDir =
    options.logsDir ??
    join(options.homedir, '.config', 'concierge', 'setup-logs');
  const newest = await findNewestSetupLog(logsDir);
  if (newest === null) {
    sections.push({ name: 'Last Setup Log', status: 'not-installed' });
    return `## Last Setup Log (tail 200)\n\n[no logs]`;
  }
  let raw: string;
  try {
    raw = await readFile(newest, 'utf8');
  } catch {
    sections.push({ name: 'Last Setup Log', status: 'error' });
    return `## Last Setup Log (tail 200)\n\n[unreadable: ${basename(newest)}]`;
  }
  const tail = tailLines(raw, 200);
  sections.push({ name: 'Last Setup Log', status: 'included' });
  return [
    `## Last Setup Log (tail 200)`,
    '',
    '```ndjson',
    redact(tail),
    '```',
  ].join('\n');
}

async function renderGwsAuthStatusSection(
  redact: Redactor,
  sections: DiagnoseSection[],
): Promise<string> {
  const bin = resolveBin('gws');
  const result = await runCaptureFull(bin, ['auth', 'status']);
  if (result.kind === 'enoent') {
    sections.push({ name: 'gws auth status', status: 'not-installed' });
    return `## gws auth status\n\n[not installed]`;
  }
  if (result.kind === 'failed' && result.exitCode === 2) {
    sections.push({ name: 'gws auth status', status: 'included' });
    return `## gws auth status\n\n[not authenticated]`;
  }
  if (result.kind === 'failed') {
    sections.push({ name: 'gws auth status', status: 'error' });
    return [
      `## gws auth status`,
      '',
      `[error: exit ${String(result.exitCode)}]`,
      '',
      '```',
      redact(result.stderr.trim()),
      '```',
    ].join('\n');
  }
  // Try to pretty-print JSON; fall back to raw on parse failure.
  let body = result.stdout.trim();
  try {
    const parsed: unknown = JSON.parse(body);
    body = JSON.stringify(parsed, null, 2);
  } catch {
    // not JSON, leave raw.
  }
  sections.push({ name: 'gws auth status', status: 'included' });
  return ['## gws auth status', '', '```json', redact(body), '```'].join('\n');
}

async function renderGcloudConfigSection(
  redact: Redactor,
  sections: DiagnoseSection[],
): Promise<string> {
  const bin = resolveBin('gcloud');
  const result = await runCaptureFull(bin, ['config', 'list', '--format', 'json']);
  if (result.kind === 'enoent') {
    sections.push({ name: 'gcloud config', status: 'not-installed' });
    return `## gcloud config\n\n[not installed]`;
  }
  if (result.kind === 'failed') {
    sections.push({ name: 'gcloud config', status: 'error' });
    return [
      `## gcloud config`,
      '',
      `[error: exit ${String(result.exitCode)}]`,
      '',
      '```',
      redact(result.stderr.trim()),
      '```',
    ].join('\n');
  }
  let body = result.stdout.trim();
  try {
    const parsed: unknown = JSON.parse(body);
    body = JSON.stringify(parsed, null, 2);
  } catch {
    // leave raw.
  }
  sections.push({ name: 'gcloud config', status: 'included' });
  return ['## gcloud config', '', '```json', redact(body), '```'].join('\n');
}

async function renderClaudeDesktopSection(
  options: DiagnoseOptions,
  redact: Redactor,
  sections: DiagnoseSection[],
): Promise<string> {
  const found = await probeClaudeDesktopApp(options);
  if (!found) {
    sections.push({ name: 'Claude Desktop', status: 'not-installed' });
    return `## Claude Desktop\n\n[not installed]`;
  }
  // App is present. Probe the unpacked extension dir if a namespace is known.
  const ns = options.claudeExtensionNamespace;
  if (ns === undefined || ns.length === 0) {
    sections.push({ name: 'Claude Desktop', status: 'included' });
    const body = ['app: present', 'extension_dir: [namespace unknown]'].join('\n');
    return `## Claude Desktop\n\n${redact(body)}`;
  }
  const extProbe = await statClaudeExtensionDir(options.homedir, ns);
  if (!extProbe.exists) {
    sections.push({ name: 'Claude Desktop', status: 'included' });
    const body = [
      'app: present',
      `extension_dir: ${extProbe.absPath}`,
      'unpacked: [absent]',
    ].join('\n');
    return `## Claude Desktop\n\n${redact(body)}`;
  }
  // Unpacked dir present. Hash dist/index.js for tamper-detection signal.
  const distPath = join(extProbe.absPath, 'dist', 'index.js');
  let sha = '[unhashable]';
  try {
    const buf = await readFile(distPath);
    sha = createHash('sha256').update(buf).digest('hex');
  } catch {
    // leave [unhashable]
  }
  sections.push({ name: 'Claude Desktop', status: 'included' });
  const body = [
    'app: present',
    `extension_dir: ${basename(extProbe.absPath)}`,
    `dist_index_js_sha256: ${sha}`,
  ].join('\n');
  return `## Claude Desktop\n\n${redact(body)}`;
}

async function renderClaudeCliSection(
  options: DiagnoseOptions,
  redact: Redactor,
  sections: DiagnoseSection[],
): Promise<string> {
  const claudeBin = resolveBin('claude');
  const present = await commandExists(claudeBin);
  if (!present) {
    sections.push({ name: 'Claude CLI', status: 'not-installed' });
    return `## Claude CLI\n\n[not installed]`;
  }
  // Read ~/.claude.json (via B6) and extract just the concierge entry.
  let raw: string | null;
  try {
    raw = await readClaudeJson(options.homedir);
  } catch (err) {
    sections.push({ name: 'Claude CLI', status: 'error' });
    return [
      `## Claude CLI`,
      '',
      `[error reading ~/.claude.json: ${(err as Error).message}]`,
    ].join('\n');
  }
  if (raw === null) {
    sections.push({ name: 'Claude CLI', status: 'included' });
    return `## Claude CLI\n\n[no ~/.claude.json]`;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    sections.push({ name: 'Claude CLI', status: 'error' });
    return `## Claude CLI\n\n[~/.claude.json is not valid JSON]`;
  }
  const concierge = extractConciergeEntry(parsed);
  sections.push({ name: 'Claude CLI', status: 'included' });
  if (concierge === null) {
    return `## Claude CLI\n\n[mcpServers.concierge not registered]`;
  }
  const body = JSON.stringify(concierge, null, 2);
  return ['## Claude CLI', '', '```json', redact(body), '```'].join('\n');
}

// --- bundle writer -----------------------------------------------------------

async function writeBundle(
  text: string,
  options: DiagnoseOptions,
): Promise<string> {
  const ts = options.timestamp ?? new Date();
  const stamp = ts.toISOString().replace(/:/g, '-');
  const baseName = options.full
    ? `concierge-diagnose-${stamp}-full`
    : `concierge-diagnose-${stamp}`;
  const outputDir = options.outputDir ?? join(options.homedir, 'Desktop');
  const tarballPath = join(outputDir, `${baseName}.tar.gz`);

  // Stage the txt in a tempdir so the tarball contains a single top-level
  // entry with the same base name as the tarball.
  const stageRoot = await mkdtemp(join(tmpdir(), 'concierge-diagnose-'));
  try {
    const txtPath = join(stageRoot, `${baseName}.txt`);
    await writeFile(txtPath, text, 'utf8');

    // System tar (BSD on macOS, GNU on Linux). Both accept `-C` + `-czf`.
    await execFileP('tar', [
      '-czf',
      tarballPath,
      '-C',
      stageRoot,
      `${baseName}.txt`,
    ]);
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }

  return tarballPath;
}

// --- helpers -----------------------------------------------------------------

interface RunOk {
  kind: 'ok';
  stdout: string;
  stderr: string;
  exitCode: 0;
}
interface RunFailed {
  kind: 'failed';
  exitCode: number;
  stdout: string;
  stderr: string;
}
interface RunEnoent {
  kind: 'enoent';
}

/** Run a command capturing stdout + stderr; classify result for the renderers. */
async function runCaptureFull(
  bin: string,
  argv: readonly string[],
): Promise<RunOk | RunFailed | RunEnoent> {
  return new Promise((resolve) => {
    execFile(bin, argv, { encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err === null) {
        resolve({ kind: 'ok', stdout, stderr, exitCode: 0 });
        return;
      }
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        resolve({ kind: 'enoent' });
        return;
      }
      // execFile decorates err with a numeric `code` field when the child
      // exited non-zero, OR a string `code` when an OS error fired (other
      // than ENOENT, which we already returned above).
      const numericExit = pickNumericExit(err);
      resolve({
        kind: 'failed',
        exitCode: numericExit ?? -1,
        stdout,
        stderr,
      });
    });
  });
}

function pickNumericExit(err: unknown): number | null {
  if (err === null || typeof err !== 'object') return null;
  const e = err as { code?: unknown };
  if (typeof e.code === 'number') return e.code;
  return null;
}

/** Run a command, return the first non-empty line of stdout, or null on failure. */
async function runCaptureFirstLine(
  bin: string,
  argv: readonly string[],
): Promise<string | null> {
  const r = await runCaptureFull(bin, argv);
  if (r.kind !== 'ok') return null;
  const firstLine = r.stdout.split('\n').find((l) => l.trim().length > 0);
  return firstLine !== undefined ? firstLine.trim() : null;
}

async function commandExists(bin: string): Promise<boolean> {
  // Probe with --version (cheap + portable). ENOENT = missing.
  const r = await runCaptureFull(bin, ['--version']);
  return r.kind !== 'enoent';
}

/**
 * Resolve a CLI binary name. Tests inject CONCIERGE_TEST_<TOOL>_BIN to point
 * at fixture shims (or `/usr/bin/false` to simulate absence). Mirrors the
 * resolution pattern in phases/oauth.ts.
 */
function resolveBin(tool: string): string {
  const upper = tool.toUpperCase().replace(/-/g, '_');
  return process.env[`CONCIERGE_TEST_${upper}_BIN`] ?? tool;
}

/** Return the last `n` lines of `raw`, preserving the trailing newline shape. */
function tailLines(raw: string, n: number): string {
  const lines = raw.split('\n');
  // If the file ends with \n, split() yields a trailing empty string. Drop it
  // so "last 200" doesn't include the empty terminator, then re-append.
  const trailingEmpty = lines.length > 0 && lines[lines.length - 1] === '';
  if (trailingEmpty) lines.pop();
  if (lines.length <= n) {
    return lines.join('\n');
  }
  return lines.slice(lines.length - n).join('\n');
}

const SETUP_LOG_RE = /^setup-.+\.log$/;

async function findNewestSetupLog(logsDir: string): Promise<string | null> {
  let entries: string[];
  try {
    entries = await readdir(logsDir);
  } catch {
    return null;
  }
  const candidates = entries.filter((n) => SETUP_LOG_RE.test(n));
  if (candidates.length === 0) return null;
  const stats = await Promise.all(
    candidates.map(async (name) => {
      const full = join(logsDir, name);
      const st = await stat(full);
      return { full, mtimeMs: st.mtimeMs };
    }),
  );
  stats.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return stats[0]?.full ?? null;
}

async function probeClaudeDesktopApp(
  options: DiagnoseOptions,
): Promise<boolean> {
  const candidates: string[] = [];
  if (options.claudeDesktopAppPath !== undefined) {
    candidates.push(options.claudeDesktopAppPath);
  } else {
    candidates.push('/Applications/Claude.app');
    candidates.push(join(options.homedir, 'Applications', 'Claude.app'));
  }
  for (const p of candidates) {
    try {
      const st = await stat(p);
      if (st.isDirectory()) return true;
    } catch {
      // continue
    }
  }
  return false;
}

interface ParsedClaudeJson {
  mcpServers?: Record<string, unknown>;
}

function extractConciergeEntry(parsed: unknown): unknown {
  if (parsed === null || typeof parsed !== 'object') return null;
  const top = parsed as ParsedClaudeJson;
  const servers = top.mcpServers;
  if (servers === undefined || servers === null || typeof servers !== 'object') {
    return null;
  }
  const concierge = (servers as Record<string, unknown>)['concierge'];
  return concierge ?? null;
}

// --- back-compat for callers that want the system homedir ---------------------

/** Resolve options.homedir lazily, preserving test injection. */
export function defaultHomedir(): string {
  return osHomedir();
}
