// Probe timing harness — measures wall-clock for runAllProbes() with a
// pre-shimmed environment so no real installs occur. Writes the duration to
// GITHUB_STEP_SUMMARY and alarms (exit 1) if >=180_000ms.
//
// Driven from .github/workflows/ci.yml (the `setup-orchestrator` job) per
// spec acceptance N6: warm-re-run target <=3 min.
//
// Pure helpers (`shouldAlarm`, `formatSummary`, `runHarness`) are exported so
// tests in tests/scripts/probe-timing-harness.test.ts can exercise the
// alarm/format paths without invoking the real probes phase.

import { mkdirSync, mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAllProbes } from '../src/phases/probe.js';
import type { ProbeContext } from '../src/phases/probe.js';
import type { ProbeResult } from '../src/types/probe.js';

export const ALARM_MS = 3 * 60 * 1000;

export function shouldAlarm(elapsedMs: number, alarmMs: number): boolean {
  return elapsedMs >= alarmMs;
}

export function formatSummary(
  elapsedMs: number,
  alarmMs: number,
  probes: readonly ProbeResult[],
): string {
  const probeCount = probes.length;
  const oks = probes.filter((r) => r.status === 'ok').length;
  const verdict = shouldAlarm(elapsedMs, alarmMs)
    ? `> **ALARM:** probe phase took ${elapsedMs}ms which exceeds the ${alarmMs}ms regression threshold (N6).`
    : `> Within budget.`;
  return [
    '## Probe timing — warm re-run',
    '',
    `- **Wall clock:** ${elapsedMs}ms (alarm threshold: ${alarmMs}ms / ${alarmMs / 1000}s)`,
    `- **Probes:** ${probeCount} total, ${oks} ok`,
    '',
    verdict,
    '',
  ].join('\n');
}

export interface HarnessDeps {
  probes: (ctx: ProbeContext) => Promise<readonly ProbeResult[]>;
  now: () => number;
  writeSummary: (text: string) => void;
  writeError: (text: string) => void;
  exit: (code: number) => void;
  alarmMs?: number;
}

export async function runHarness(
  ctx: ProbeContext,
  deps: HarnessDeps,
): Promise<void> {
  const alarmMs = deps.alarmMs ?? ALARM_MS;
  const t0 = deps.now();
  const results = await deps.probes(ctx);
  const elapsedMs = deps.now() - t0;

  deps.writeSummary(formatSummary(elapsedMs, alarmMs, results));

  if (shouldAlarm(elapsedMs, alarmMs)) {
    deps.writeError(`probe-timing: ALARM (${elapsedMs}ms >= ${alarmMs}ms)\n`);
    deps.exit(1);
    return;
  }
  deps.exit(0);
}

async function main(): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), 'probe-timing-'));
  const homedir = join(work, 'home');
  mkdirSync(homedir, { recursive: true });
  const ctx: ProbeContext = { homedir };

  const summaryFile = process.env['GITHUB_STEP_SUMMARY'];
  const writeSummary: (text: string) => void =
    summaryFile !== undefined && summaryFile !== ''
      ? (text) => {
          appendFileSync(summaryFile, text + '\n');
        }
      : (text) => {
          process.stdout.write(text + '\n');
        };

  try {
    await runHarness(ctx, {
      probes: runAllProbes,
      now: Date.now,
      writeSummary,
      writeError: (text) => {
        process.stderr.write(text);
      },
      exit: (code) => {
        process.exit(code);
      },
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// Only auto-run when invoked as the entry point (so tests can import without
// triggering main()). Compare resolved file URL to argv[1] resolved to a URL.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (invokedDirectly) {
  main().catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`probe-timing: ${msg}\n`);
    process.exit(2);
  });
}
