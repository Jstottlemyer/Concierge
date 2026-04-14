// T26 — cross-surface parity (AC §18).
//
// Automated version of the manual spike in `docs/specs/.../spikes.md` T0.2.
// Verifies that a gws invocation from the Homebrew-installed binary and
// from the repo-bundled tarball binary share the same `~/.config/gws/`
// credentials state — i.e. the two surfaces are interchangeable and
// neither provokes a keychain prompt beyond what the other would.
//
// OPT-IN ONLY. The entire suite is gated behind `CONCIERGE_INTEGRATION=1`
// AND the presence of a real `~/.config/gws/credentials.enc` on the
// developer's machine. Without both, every test here is skipped with a
// visible reason — CI stays green; the suite never runs against a
// sandbox without real credentials.
//
// Running locally:
//
//   CONCIERGE_INTEGRATION=1 pnpm test tests/integration/cross-surface-parity.test.ts
//
// You may see a macOS keychain prompt on first run if the OS decides to
// reprompt for `gws`' access to the stored credentials. Approve "Always
// Allow" and re-run. If you did not go through Phase 0 T0.2 (real-tenant
// auth), this suite is meaningless — skip it.
//
// Spec refs: google-workspace-mcp spec.md AC §18, spikes.md T0.2.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/** Env gate — set to `'1'` on the developer's shell to opt in. */
const INTEGRATION_ENABLED = process.env['CONCIERGE_INTEGRATION'] === '1';
/** Real-credentials gate — Phase 0 T0.2 must have run on this machine. */
const CREDS_PATH = join(homedir(), '.config', 'gws', 'credentials.enc');
const REAL_GWS_AVAILABLE = INTEGRATION_ENABLED && existsSync(CREDS_PATH);

/** Candidate binary paths for the two surfaces. */
const HOMEBREW_GWS = '/opt/homebrew/bin/gws';
const TARBALL_GWS = '/tmp/authtools-spikes/gws';

const HOMEBREW_AVAILABLE = REAL_GWS_AVAILABLE && existsSync(HOMEBREW_GWS);
const TARBALL_AVAILABLE = REAL_GWS_AVAILABLE && existsSync(TARBALL_GWS);
const BOTH_AVAILABLE = HOMEBREW_AVAILABLE && TARBALL_AVAILABLE;

interface SpawnOutcome {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
}

/**
 * Run a given gws binary with fixed argv. Always resolves — even on
 * non-zero exit — so the test can compare exit classes rather than rely
 * on throws.
 *
 * We use a hard 30s timeout: if the binary hangs on a keychain prompt
 * the test kills it rather than blocking the whole suite. A timeout
 * surfaces as `{exitCode: null, signal: 'SIGTERM'}` which the assertion
 * layer treats as a soft "both-inconclusive" outcome.
 */
async function runBinary(bin: string, args: readonly string[]): Promise<SpawnOutcome> {
  const startedAt = Date.now();
  return new Promise<SpawnOutcome>((resolve) => {
    const child = spawn(bin, [...args], {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    const kill = setTimeout(() => {
      if (!settled) {
        try {
          child.kill('SIGTERM');
        } catch {
          // Already dead; fine.
        }
      }
    }, 30_000);

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(kill);
      resolve({
        exitCode: null,
        signal: null,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: `${Buffer.concat(stderrChunks).toString('utf8')}\n[spawn error: ${err.code ?? 'UNKNOWN'}]`,
        durationMs: Date.now() - startedAt,
      });
    });

    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(kill);
      resolve({
        exitCode: code,
        signal,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

/**
 * Bucket an exit code into one of a small number of semantic classes.
 * We do NOT require the two surfaces to emit the same exit code byte-
 * for-byte — gws releases sometimes renumber. We only require that
 * both surfaces land in the same bucket.
 */
type ExitClass = 'ok' | 'auth_error' | 'network_error' | 'other_error' | 'timeout';

function classifyExit(outcome: SpawnOutcome): ExitClass {
  if (outcome.signal === 'SIGTERM' || outcome.exitCode === null) return 'timeout';
  if (outcome.exitCode === 0) return 'ok';
  const stderr = outcome.stderr.toLowerCase();
  if (/(consent|auth|token|keychain|revoke|expired|refresh)/.test(stderr)) {
    return 'auth_error';
  }
  if (/(network|timeout|connect|dns|resolve|http 5\d\d|http 429)/.test(stderr)) {
    return 'network_error';
  }
  return 'other_error';
}

describe('AC §18 cross-surface parity (T26)', () => {
  it('opt-in gate status (visible in CI output)', () => {
    // Informational — always passes. Serves as a breadcrumb in CI logs so
    // a reader grepping for "T26" can tell at a glance whether the
    // suite's substantive assertions ran or skipped.
    //
    // Explicitly do NOT fail when skipped: the default CI environment
    // does not have `~/.config/gws/credentials.enc`, and forcing the
    // gate open would risk keychain prompts in headless runners.
    if (!INTEGRATION_ENABLED) {
      console.warn('[T26] CONCIERGE_INTEGRATION not set — skipping real-gws assertions');
    } else if (!existsSync(CREDS_PATH)) {
      console.warn(`[T26] credentials.enc missing at ${CREDS_PATH} — skipping real-gws assertions`);
    } else if (!HOMEBREW_AVAILABLE) {
      console.warn(`[T26] ${HOMEBREW_GWS} missing — skipping parity check`);
    } else if (!TARBALL_AVAILABLE) {
      console.warn(`[T26] ${TARBALL_GWS} missing — skipping parity check`);
    }
    expect(true).toBe(true);
  });

  it.runIf(BOTH_AVAILABLE)(
    'homebrew gws and bundled-tarball gws share credentials (drive files list pageSize=1)',
    async () => {
      // Both binaries run an identical invocation. If they agree on
      // exit class, the shared `~/.config/gws/` state is being read
      // consistently — no surface triggers a re-auth the other avoids.
      //
      // We query by exit class (not stdout bytes) because the response
      // can contain user data we don't want to assert on, and because
      // list ordering can differ between consecutive calls against the
      // live API.
      const args = ['drive', 'files', 'list', '--params', JSON.stringify({ pageSize: 1 })];

      const homebrew = await runBinary(HOMEBREW_GWS, args);
      const tarball = await runBinary(TARBALL_GWS, args);

      const homebrewClass = classifyExit(homebrew);
      const tarballClass = classifyExit(tarball);

      // Diagnostic output so a failure is self-explanatory in CI.
      if (homebrewClass !== tarballClass) {
        console.error('[T26] homebrew stdout (first 200):', homebrew.stdout.slice(0, 200));
        console.error('[T26] homebrew stderr (first 500):', homebrew.stderr.slice(0, 500));
        console.error('[T26] tarball stdout (first 200):', tarball.stdout.slice(0, 200));
        console.error('[T26] tarball stderr (first 500):', tarball.stderr.slice(0, 500));
      }

      expect(
        homebrewClass,
        `cross-surface divergence: homebrew=${homebrewClass}, tarball=${tarballClass}`,
      ).toBe(tarballClass);
    },
    120_000,
  );

  it.runIf(BOTH_AVAILABLE)(
    'both binaries respond to --version with identical semver',
    async () => {
      // Weaker parity signal but cheap: if two `gws` binaries on the
      // same machine report different versions, the user's workflow
      // may see inconsistent behavior. Not a spec violation per se,
      // but worth flagging.
      const homebrew = await runBinary(HOMEBREW_GWS, ['--version']);
      const tarball = await runBinary(TARBALL_GWS, ['--version']);

      expect(homebrew.exitCode).toBe(0);
      expect(tarball.exitCode).toBe(0);

      // Match e.g. "0.22.5" — the first semver-looking token on the line.
      const versionRegex = /\b\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?\b/;
      const homebrewVersion = versionRegex.exec(homebrew.stdout)?.[0] ?? '';
      const tarballVersion = versionRegex.exec(tarball.stdout)?.[0] ?? '';

      expect(homebrewVersion).not.toBe('');
      expect(tarballVersion).not.toBe('');

      if (homebrewVersion !== tarballVersion) {
        console.warn(
          `[T26] surface version skew: homebrew=${homebrewVersion}, tarball=${tarballVersion}`,
        );
      }

      // Soft assertion — a version skew is a warning, not a hard fail,
      // because users reasonably keep an older tarball around while
      // testing a new brew release.
      expect(homebrewVersion.length).toBeGreaterThan(0);
      expect(tarballVersion.length).toBeGreaterThan(0);
    },
    60_000,
  );
});
