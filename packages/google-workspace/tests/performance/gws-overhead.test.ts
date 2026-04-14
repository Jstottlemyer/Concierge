// T29 — MCP wrapper overhead + keychain-read performance benchmarks (AC §21-23).
//
// Gated behind `CONCIERGE_PERF=1` so default `pnpm test` skips these. Perf
// tests allocate/spawn real subprocesses (the mock harness writes a Node
// runner + shell wrapper each run) and the wall-clock thresholds are OS-load
// sensitive; CI should run them as a separate job or on a dedicated lane.
//
// Acceptance criteria under test:
//   - P2 (AC §22): keychain read < 50ms. This is a real-gws path; the mock
//     harness itself incurs ~50ms of Node-subprocess-spawn cost, which
//     dominates any measurement we could take here. We still collect and
//     report the number as a directional indicator and fail only on the
//     weaker p95 < 100ms bound (catches pathological retry loops / double
//     spawns). Real P2 enforcement lives in the manual verification
//     checklist with the real gws binary.
//   - P3 (AC §23): end-to-end wrapper overhead < 100ms (p95). Measured by
//     invoking `drive_files_list` 30 times with `delayMs: 0` so the mock
//     responds effectively instantly; total time is all wrapper + IPC
//     overhead.
//   - P1 (AC §21): initial OAuth < 3s — requires a real browser + human
//     consent, so out of scope for the automated test; documented in
//     the manual-verification checklist.
//
// Failure policy: we assert against p95, not any single sample, so a
// momentary spike on a loaded CI host does not flake the test. If the
// benchmark fails we print the full percentile table to stderr so the
// failure report is actionable.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';

import { GWS_BIN_ENV } from '../../src/gws/paths.js';
import {
  __resetVersionCacheForTests,
  runGws,
} from '../../src/gws/runner.js';
import { driveFilesList } from '../../src/tools/shims/drive-files-list.js';
import type { ToolContext } from '../../src/tools/types.js';
import {
  installGwsMock,
  type InstalledGwsMock,
} from '../helpers/gws-mock.js';
import {
  loadGwsResponseFixture,
  makeVersionScenario,
} from '../helpers/gws-mock-scenarios.js';

const PERF_ENABLED = process.env['CONCIERGE_PERF'] === '1';
const describeOrSkip = PERF_ENABLED ? describe : describe.skip;

/** Number of samples collected per benchmark. */
const SAMPLE_COUNT = 30;

/** p95 wrapper overhead threshold per AC §23 (milliseconds). */
const P3_WRAPPER_OVERHEAD_P95_MS = 100;

/** Documented AC §22 budget (milliseconds); informational only under the mock harness. */
const P2_PRE_SPAWN_P95_MS = 50;

const ctx: ToolContext = { now: '2026-04-13T00:00:00.000Z' };

interface Percentiles {
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly min: number;
  readonly max: number;
}

function percentiles(samples: readonly number[]): Percentiles {
  const sorted = [...samples].sort((a, b) => a - b);
  const pick = (p: number): number => {
    if (sorted.length === 0) return 0;
    const idx = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(p * sorted.length) - 1),
    );
    return sorted[idx] ?? 0;
  };
  return {
    p50: pick(0.5),
    p95: pick(0.95),
    p99: pick(0.99),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  };
}

function report(label: string, pcts: Percentiles): void {
  // Perf output goes to stderr because MCP owns stdout (protocol bytes).
  process.stderr.write(
    `[perf] ${label}: ` +
      `p50=${pcts.p50.toFixed(2)}ms ` +
      `p95=${pcts.p95.toFixed(2)}ms ` +
      `p99=${pcts.p99.toFixed(2)}ms ` +
      `min=${pcts.min.toFixed(2)}ms max=${pcts.max.toFixed(2)}ms ` +
      `(n=${String(SAMPLE_COUNT)})\n`,
  );
}

describeOrSkip('T29 — MCP wrapper overhead benchmarks', () => {
  let mock: InstalledGwsMock | null = null;
  const priorBin = process.env[GWS_BIN_ENV];

  beforeEach(() => {
    __resetVersionCacheForTests();
  });

  afterEach(async () => {
    if (mock !== null) {
      await mock.uninstall();
      mock = null;
    }
    __resetVersionCacheForTests();
    if (priorBin === undefined) delete process.env[GWS_BIN_ENV];
    else process.env[GWS_BIN_ENV] = priorBin;
  });

  it(
    `P3 (AC §23): p95 end-to-end wrapper overhead < ${String(P3_WRAPPER_OVERHEAD_P95_MS)}ms over ${String(SAMPLE_COUNT)} drive_files_list calls`,
    async () => {
      mock = await installGwsMock({
        scenarios: [
          makeVersionScenario(),
          {
            matchArgs: [
              'drive', 'files', 'list',
              '--format', 'json',
              '--params', JSON.stringify({ pageSize: 50 }),
            ],
            stdout: loadGwsResponseFixture('drive.files.list'),
            exitCode: 0,
            delayMs: 0,
          },
        ],
      });

      // Warm the version cache + kernel/fs caches with one throwaway call.
      await driveFilesList.invoke({}, ctx);

      const samples: number[] = [];
      for (let i = 0; i < SAMPLE_COUNT; i++) {
        const start = performance.now();
        const result = await driveFilesList.invoke({}, ctx);
        const elapsed = performance.now() - start;
        if (!result.ok) {
          throw new Error(
            `drive_files_list returned error during benchmark: ${JSON.stringify(result.error)}`,
          );
        }
        samples.push(elapsed);
      }

      const pcts = percentiles(samples);
      report('wrapper_overhead_drive_files_list', pcts);
      expect(pcts.p95).toBeLessThan(P3_WRAPPER_OVERHEAD_P95_MS);
    },
    // Default 5s vitest timeout is too tight when the perf harness spawns
    // N subprocesses in sequence; allow 60s.
    60_000,
  );

  it(
    `P2 (AC §22) analog: report pre-spawn wrapper overhead (budget ${String(P2_PRE_SPAWN_P95_MS)}ms)`,
    async () => {
      // P2 bounds the KEYCHAIN-READ slice (tool invocation → token available
      // to gws), which is a real-gws path we cannot simulate with the mock.
      // The mock's own Node subprocess spawn dominates the measurement
      // (~50ms on macOS; production gws is native Rust with a shorter
      // startup path). What we CAN do here is report the wrapper's
      // spawn+capture time as a directional proxy — a number that strictly
      // dominates the real path (mock pays Node startup; real gws does not).
      // Treat this as an informational measurement; hard P2 enforcement
      // happens in the manual verification checklist against real gws.
      mock = await installGwsMock({
        scenarios: [
          makeVersionScenario(),
          {
            matchArgs: ['drive', 'files', 'list', '--format', 'json'],
            stdout: '{}',
            exitCode: 0,
            delayMs: 0,
          },
        ],
      });

      // Warm the version cache so cost isn't amortized into sample 0.
      await runGws(['--version']);

      const samples: number[] = [];
      for (let i = 0; i < SAMPLE_COUNT; i++) {
        const start = performance.now();
        const result = await runGws(['drive', 'files', 'list', '--format', 'json']);
        const elapsed = performance.now() - start;
        if (result.exitCode !== 0) {
          throw new Error(`runGws exit ${String(result.exitCode)}: ${result.stderr}`);
        }
        samples.push(elapsed);
      }

      const pcts = percentiles(samples);
      report('pre_spawn_overhead_runGws', pcts);
      // Hard assertion: the mock-dominated path should at least stay under
      // the end-to-end wrapper budget (100ms). That's a weak bound but
      // catches pathological regressions (e.g., retry loops, unintended
      // double-spawns).
      expect(pcts.p95).toBeLessThan(P3_WRAPPER_OVERHEAD_P95_MS);
    },
    60_000,
  );

  it('P1 (AC §21) — initial OAuth < 3s: documented as manual verification only', () => {
    // P1 needs a real browser consent loop; we cannot simulate a human
    // clicking through the Google consent screen. This test serves as
    // documentation: the real number is measured in the manual
    // verification checklist before a release.
    expect(true).toBe(true);
  });
});
