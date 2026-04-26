// C3: Install phase — serial brew installs/upgrades for the tools the probe
// phase reported as missing/stale.
//
// Why serial: Homebrew holds an internal global lock; parallel `brew install`
// invocations just queue on that lock and produce interleaved/garbled stdout
// that breaks our progress streaming. We run one at a time, in a deterministic
// order, so each tool's progress block is cleanly bracketed by `→ Installing
// <tool>...` / `✓ <tool> <version> installed` lines.
//
// Order rationale:
//   node     — Other tools' post-install probes may rely on Node being present
//              (npm fallback for claude CLI in particular).
//   gws      — Independent; auto-upgrade lives here when the C1 probe set
//              `needsUpgrade: true` on the gws.version composite.
//   gcloud   — Cask install; needed for `gcloud services enable` later.
//   claude   — Last so the freshly-installed CLI doesn't race a still-running
//              `gws auth login` (gws spawns a browser; some Claude CLI install
//              scripts try to register MCP servers eagerly which would touch
//              `~/.claude.json` mid-OAuth).
//   claude-desktop — Cask install of the Anthropic Claude Desktop app.
//
// Failure semantics: ABORT remaining steps on first failure. The returned
// InstallResult[] surfaces the failed step with its stderr tail; downstream
// steps come back as `skipped` with no version. The orchestrator surfaces
// this and lets the user retry.
//
// brew-vs-npm decision for `claude` CLI: a runtime probe — we run
// `brew search claude-code` first; if it returns a hit, we use brew. Otherwise
// we fall back to `npm install -g @anthropic-ai/claude-code`. The decision is
// deferred to runInstallSteps (not planInstallSteps) because brew search
// requires a subprocess; planInstallSteps stays pure.

import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

import type {
  GwsVersionDetail,
  ProbeResult,
} from '../types/probe.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type InstallableTool =
  | 'node'
  | 'gws'
  | 'gcloud'
  | 'claude'
  | 'claude-desktop';

export interface InstallStep {
  tool: InstallableTool;
  action: 'install' | 'upgrade';
  /** brew package name (may differ from tool name, e.g. 'googleworkspace-cli'
   *  for gws). For the claude CLI step, this is the *preferred* brew package;
   *  if `brew search` misses it at runtime, runInstallSteps falls back to npm
   *  with the corresponding npm package name. */
  brewPackage: string;
  /** Whether this is a cask install (--cask flag). */
  isCask: boolean;
}

export interface InstallResult {
  tool: InstallableTool;
  status: 'installed' | 'upgraded' | 'skipped' | 'failed';
  /** Post-install version captured by re-probing the tool. Undefined when
   *  status is 'skipped' or version capture itself failed (rare). */
  version?: string;
  /** For status === 'failed': last 20 lines of captured stderr. */
  stderr?: string;
  /** Wall-clock duration of this step (excludes per-call setup). 0 for
   *  'skipped' steps. */
  durationMs: number;
  /** When status === 'installed' for the claude CLI specifically, records
   *  whether brew or npm was used. Undefined for all other steps. */
  installer?: 'brew' | 'npm';
}

export interface InstallContext {
  /** Stream callback for per-line progress. The UI module attaches a
   *  renderer; tests can capture lines for assertion. Lines are emitted
   *  WITHOUT trailing newlines. */
  onProgress?: (line: string) => void;
  /** Override brew binary path (test only). Defaults to `brew` (PATH lookup). */
  brewBin?: string;
  /** Override npm binary path (test only). Defaults to `npm`. */
  npmBin?: string;
  /** Override the post-install version probe binary lookup. Maps tool name to
   *  an absolute path so tests can point at shims that respond to
   *  `<tool> --version`. */
  versionBins?: Partial<Record<InstallableTool, string>>;
  /** Override of the brew-vs-npm decision for the claude CLI. When set, skips
   *  the `brew search` probe and uses the chosen installer directly. Only
   *  consulted in tests. */
  claudeInstaller?: 'brew' | 'npm';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

interface BrewMapping {
  brewPackage: string;
  isCask: boolean;
}

/** brew package mapping for each installable tool. Note: the `claude` CLI
 *  entry is the *preferred* brew name; runInstallSteps may swap to npm at
 *  runtime if `brew search` misses it. */
const BREW_MAP: Readonly<Record<InstallableTool, BrewMapping>> = {
  node: { brewPackage: 'node@20', isCask: false },
  gws: { brewPackage: 'googleworkspace-cli', isCask: false },
  gcloud: { brewPackage: 'google-cloud-sdk', isCask: true },
  claude: { brewPackage: 'claude-code', isCask: false },
  'claude-desktop': { brewPackage: 'claude', isCask: true },
};

/** npm package fallback for the claude CLI when brew search misses. */
const CLAUDE_NPM_PACKAGE = '@anthropic-ai/claude-code';

/** Stable serial order: node → gws → gcloud → claude → claude-desktop. */
const TOOL_ORDER: readonly InstallableTool[] = [
  'node',
  'gws',
  'gcloud',
  'claude',
  'claude-desktop',
];

const TOOL_ORDER_IDX: ReadonlyMap<InstallableTool, number> = new Map(
  TOOL_ORDER.map((t, i) => [t, i]),
);

/** Probe names that drive `install` (status === 'missing' → install step). */
const PROBE_TO_TOOL: Readonly<Record<string, InstallableTool>> = {
  node: 'node',
  gws: 'gws',
  gcloud: 'gcloud',
  'claude.cli': 'claude',
  'claude.desktop': 'claude-desktop',
};

// ---------------------------------------------------------------------------
// planInstallSteps
// ---------------------------------------------------------------------------

/**
 * Plan the install steps from probe results. Pure function — no subprocess
 * calls.
 *
 * Rules:
 *   - For each probe with status === 'missing' that maps to a known tool,
 *     emit `{ action: 'install' }`.
 *   - For the gws.version composite: when its detail.needsUpgrade === true,
 *     emit `{ tool: 'gws', action: 'upgrade' }`. The semver-compare logic
 *     that produced `needsUpgrade` lives in C1 (probe phase); we trust it.
 *   - If both an install AND an upgrade would be planned for gws (shouldn't
 *     happen since the probe statuses are mutually exclusive), prefer the
 *     install — there's nothing to upgrade if it's not installed.
 *   - Output is stable-sorted by TOOL_ORDER.
 */
export function planInstallSteps(
  probes: readonly ProbeResult[],
): readonly InstallStep[] {
  const byTool = new Map<InstallableTool, InstallStep>();

  for (const p of probes) {
    // Install candidates: any probe that maps to a tool and is missing.
    const tool = PROBE_TO_TOOL[p.name];
    if (tool !== undefined && p.status === 'missing') {
      const m = BREW_MAP[tool];
      byTool.set(tool, {
        tool,
        action: 'install',
        brewPackage: m.brewPackage,
        isCask: m.isCask,
      });
      continue;
    }
    // Upgrade candidate: gws.version with needsUpgrade.
    if (p.name === 'gws.version') {
      const detail = p.detail as GwsVersionDetail | undefined;
      if (detail !== undefined && detail.needsUpgrade) {
        // Don't override an existing install step (install wins).
        if (!byTool.has('gws')) {
          const m = BREW_MAP['gws'];
          byTool.set('gws', {
            tool: 'gws',
            action: 'upgrade',
            brewPackage: m.brewPackage,
            isCask: m.isCask,
          });
        }
      }
    }
  }

  return [...byTool.values()].sort(
    (a, b) =>
      (TOOL_ORDER_IDX.get(a.tool) ?? 0) - (TOOL_ORDER_IDX.get(b.tool) ?? 0),
  );
}

// ---------------------------------------------------------------------------
// runInstallSteps
// ---------------------------------------------------------------------------

interface SpawnOutcome {
  exitCode: number;
  stderrTail: string;
}

/** Run a binary, streaming each stdout/stderr line through onProgress.
 *  Captures up to the last 20 stderr lines for failure-reporting. */
async function streamSpawn(
  bin: string,
  args: readonly string[],
  onProgress: ((line: string) => void) | undefined,
): Promise<SpawnOutcome> {
  return new Promise((resolve) => {
    const child = spawn(bin, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    const stderrLines: string[] = [];
    let stdoutCarry = '';
    let stderrCarry = '';

    const flushLines = (
      carry: string,
      sink: ((line: string) => void) | undefined,
      tap?: (line: string) => void,
    ): string => {
      const parts = carry.split(/\r?\n/);
      const remainder = parts.pop() ?? '';
      for (const line of parts) {
        if (line.length > 0) {
          tap?.(line);
          sink?.(line);
        }
      }
      return remainder;
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutCarry += chunk.toString('utf8');
      stdoutCarry = flushLines(stdoutCarry, onProgress);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrCarry += chunk.toString('utf8');
      stderrCarry = flushLines(stderrCarry, onProgress, (line) => {
        stderrLines.push(line);
        if (stderrLines.length > 200) stderrLines.shift();
      });
    });
    child.on('error', () => {
      // Spawn-level failure (ENOENT, EACCES). Surface as exit -1 so callers
      // branch on `code !== 0` cleanly.
      resolve({ exitCode: -1, stderrTail: stderrCarry || stdoutCarry });
    });
    child.on('close', (code) => {
      // Drain trailing carry — don't drop lines that arrived without a
      // terminating newline.
      if (stdoutCarry.length > 0) {
        onProgress?.(stdoutCarry);
        stdoutCarry = '';
      }
      if (stderrCarry.length > 0) {
        onProgress?.(stderrCarry);
        stderrLines.push(stderrCarry);
        stderrCarry = '';
      }
      const tail = stderrLines.slice(-20).join('\n');
      resolve({ exitCode: code ?? -1, stderrTail: tail });
    });
  });
}

/** Probe `<tool> --version` after install. Best-effort: if version capture
 *  fails we still report the step as installed/upgraded (the brew exit was
 *  the source-of-truth) but leave the version field undefined. */
async function probePostInstallVersion(
  tool: InstallableTool,
  ctx: InstallContext,
): Promise<string | undefined> {
  // claude-desktop is a GUI cask — no `--version` to call. Return undefined.
  if (tool === 'claude-desktop') return undefined;

  const bin = ctx.versionBins?.[tool] ?? defaultBinForTool(tool);
  let captured = '';
  let exitCode = -1;
  await new Promise<void>((resolve) => {
    const child = spawn(bin, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout?.on('data', (c: Buffer) => {
      captured += c.toString('utf8');
    });
    child.on('error', () => {
      resolve();
    });
    child.on('close', (code) => {
      exitCode = code ?? -1;
      resolve();
    });
  });
  if (exitCode !== 0) return undefined;
  return parseVersionOutput(tool, captured);
}

function defaultBinForTool(tool: InstallableTool): string {
  switch (tool) {
    case 'node':
      return 'node';
    case 'gws':
      return 'gws';
    case 'gcloud':
      return 'gcloud';
    case 'claude':
      return 'claude';
    case 'claude-desktop':
      return 'true';
  }
}

function parseVersionOutput(tool: InstallableTool, raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  switch (tool) {
    case 'node': {
      // `v20.10.0` → `20.10.0`
      return trimmed.startsWith('v') ? trimmed.slice(1) : trimmed;
    }
    case 'gws': {
      const m = /gws\s+([0-9]+\.[0-9]+\.[0-9]+(?:[-+][\w.-]+)?)/.exec(trimmed);
      return m?.[1] ?? trimmed;
    }
    case 'gcloud': {
      const line = trimmed.split('\n')[0] ?? trimmed;
      const m = /Google Cloud SDK\s+([\w.\-+]+)/.exec(line);
      return m?.[1] ?? line;
    }
    case 'claude': {
      const m = /claude\s+([\w.\-+]+)/.exec(trimmed);
      return m?.[1] ?? trimmed;
    }
    case 'claude-desktop':
      return undefined;
  }
}

/** Decide whether to install the claude CLI via brew or npm at runtime. */
async function chooseClaudeInstaller(
  ctx: InstallContext,
): Promise<'brew' | 'npm'> {
  if (ctx.claudeInstaller !== undefined) return ctx.claudeInstaller;
  const brew = ctx.brewBin ?? 'brew';
  // `brew search claude-code` exits 0 + lists matches when found, exit 1 with
  // "No formula or cask found" otherwise. We only care about the exit code.
  const outcome = await streamSpawn(brew, ['search', 'claude-code'], undefined);
  return outcome.exitCode === 0 ? 'brew' : 'npm';
}

/**
 * Run install steps SERIALLY in the given order. On first failure, abort
 * remaining steps and mark them `skipped`. Each step emits an opening
 * `→ Installing <tool>...` line and a closing `✓ <tool> <version> installed`
 * line via onProgress, with raw brew/npm output streamed in between.
 */
export async function runInstallSteps(
  steps: readonly InstallStep[],
  ctx: InstallContext,
): Promise<readonly InstallResult[]> {
  const results: InstallResult[] = [];
  let aborted = false;

  for (const step of steps) {
    if (aborted) {
      results.push({
        tool: step.tool,
        status: 'skipped',
        durationMs: 0,
      });
      continue;
    }

    const verb = step.action === 'upgrade' ? 'Upgrading' : 'Installing';
    ctx.onProgress?.(`→ ${verb} ${step.tool}...`);
    const start = performance.now();

    let outcome: SpawnOutcome;
    let installer: 'brew' | 'npm' = 'brew';

    if (step.tool === 'claude' && step.action === 'install') {
      installer = await chooseClaudeInstaller(ctx);
      if (installer === 'npm') {
        const npm = ctx.npmBin ?? 'npm';
        outcome = await streamSpawn(
          npm,
          ['install', '-g', CLAUDE_NPM_PACKAGE],
          ctx.onProgress,
        );
      } else {
        const brew = ctx.brewBin ?? 'brew';
        outcome = await streamSpawn(
          brew,
          ['install', step.brewPackage],
          ctx.onProgress,
        );
      }
    } else {
      const brew = ctx.brewBin ?? 'brew';
      const args: string[] = [step.action];
      if (step.isCask) args.push('--cask');
      args.push(step.brewPackage);
      outcome = await streamSpawn(brew, args, ctx.onProgress);
    }

    const durationMs = performance.now() - start;

    if (outcome.exitCode !== 0) {
      ctx.onProgress?.(
        `✗ ${step.tool} ${step.action} failed (exit ${String(outcome.exitCode)})`,
      );
      const failed: InstallResult = {
        tool: step.tool,
        status: 'failed',
        durationMs,
      };
      if (outcome.stderrTail.length > 0) failed.stderr = outcome.stderrTail;
      if (step.tool === 'claude' && step.action === 'install') {
        failed.installer = installer;
      }
      results.push(failed);
      aborted = true;
      continue;
    }

    const version = await probePostInstallVersion(step.tool, ctx);
    const closingVersion = version ?? '(installed)';
    const verbDone = step.action === 'upgrade' ? 'upgraded' : 'installed';
    ctx.onProgress?.(`✓ ${step.tool} ${closingVersion} ${verbDone}`);

    const ok: InstallResult = {
      tool: step.tool,
      status: step.action === 'upgrade' ? 'upgraded' : 'installed',
      durationMs,
    };
    if (version !== undefined) ok.version = version;
    if (step.tool === 'claude' && step.action === 'install') {
      ok.installer = installer;
    }
    results.push(ok);
  }

  return results;
}
