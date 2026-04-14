// T9 — auto-consent orchestration tests.
//
// Uses a mocked ProgressEmitter + a scripted GwsRunner so we never touch a
// real subprocess. The `authInProgressProbe` is also a plain stub — T10 will
// provide the real pidfile-based implementation.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BUNDLES } from '../../src/bundles/constants.js';
import type { BundleId } from '../../src/bundles/types.js';
import {
  CONSENT_TIMEOUT_MS,
  ensureBundleGranted,
  type AuthInProgressProbe,
  type ConsentContext,
  type GrantedBundlesLookup,
} from '../../src/auth/consent-flow.js';
import type { GwsRunnerFn } from '../../src/auth/granted-bundles.js';
import type { ProgressEmitter, ProgressStage } from '../../src/mcp/progress.js';
import type { RunResult } from '../../src/gws/runner.js';

/** RunResult factory with sensible defaults. */
function mkResult(overrides: Partial<RunResult>): RunResult {
  return {
    exitCode: 0,
    signal: null,
    stdout: '',
    stderr: '',
    durationMs: 1,
    gwsVersion: 'gws 0.22.5-fake',
    ...overrides,
  };
}

/** Builds a recording ProgressEmitter. */
function mkEmitter(): { emit: ProgressEmitter; stages: ProgressStage[] } {
  const stages: ProgressStage[] = [];
  const emit: ProgressEmitter = async (stage) => {
    stages.push(stage);
  };
  return { emit, stages };
}

/** Stub granted-bundles lookup returning the specified set every call. */
function stubGrantedLookup(bundles: ReadonlySet<BundleId>): GrantedBundlesLookup {
  return async () => bundles;
}

/** Stub probe returning a fixed answer. */
function stubProbe(inFlight: boolean): AuthInProgressProbe {
  return async () => inFlight;
}

/** Full context builder — callers override just what they need. */
function mkCtx(overrides: Partial<ConsentContext>): ConsentContext {
  const fallbackRunner: GwsRunnerFn = async () => mkResult({ exitCode: 0 });
  return {
    runGws: overrides.runGws ?? fallbackRunner,
    authInProgressProbe: overrides.authInProgressProbe ?? stubProbe(false),
    getGrantedBundles: overrides.getGrantedBundles ?? stubGrantedLookup(new Set()),
    ...(overrides.invalidateGrantedCache !== undefined
      ? { invalidateGrantedCache: overrides.invalidateGrantedCache }
      : {}),
    ...(overrides.consentTimeoutMs !== undefined
      ? { consentTimeoutMs: overrides.consentTimeoutMs }
      : {}),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ensureBundleGranted — happy path (service already granted)', () => {
  it('returns granted without spawning auth login when service is in a granted bundle', async () => {
    const runGws = vi.fn<GwsRunnerFn>();
    // Seed: productivity already granted.
    const ctx = mkCtx({
      runGws,
      getGrantedBundles: stubGrantedLookup(new Set<BundleId>(['productivity'])),
    });
    const { emit, stages } = mkEmitter();

    const result = await ensureBundleGranted({
      service: 'drive',
      account: 'alice@example.com',
      emitProgress: emit,
      ctx,
    });

    expect(result.status).toBe('granted');
    if (result.status === 'granted') {
      expect(result.bundleId).toBe('productivity');
      expect(result.account).toBe('alice@example.com');
    }
    // No subprocess was spawned.
    expect(runGws).not.toHaveBeenCalled();
    // Only the initial detecting_grant stage was emitted.
    expect(stages).toEqual(['detecting_grant']);
  });

  it('picks the first granted bundle containing the service', async () => {
    const ctx = mkCtx({
      // Drive is in productivity, creator, and automation. If the user has
      // creator granted but not productivity, we should pick creator.
      getGrantedBundles: stubGrantedLookup(new Set<BundleId>(['creator'])),
    });
    const { emit } = mkEmitter();

    const result = await ensureBundleGranted({
      service: 'drive',
      account: 'alice@example.com',
      emitProgress: emit,
      ctx,
    });

    expect(result.status).toBe('granted');
    if (result.status === 'granted') {
      expect(result.bundleId).toBe('creator');
    }
  });
});

describe('ensureBundleGranted — consent flow (ungranted service)', () => {
  it('spawns gws auth login when no granted bundle covers the service', async () => {
    const runGws = vi.fn<GwsRunnerFn>().mockResolvedValue(mkResult({ exitCode: 0 }));
    const invalidator = vi.fn<(account: string) => void>();
    const ctx = mkCtx({
      runGws,
      getGrantedBundles: stubGrantedLookup(new Set()),
      invalidateGrantedCache: invalidator,
    });
    const { emit, stages } = mkEmitter();

    const result = await ensureBundleGranted({
      service: 'chat',
      account: 'alice@example.com',
      emitProgress: emit,
      ctx,
    });

    expect(result.status).toBe('granted');
    if (result.status === 'granted') {
      expect(result.bundleId).toBe('collaboration');
    }
    expect(runGws).toHaveBeenCalledTimes(1);
    const [argv] = runGws.mock.calls[0] ?? [];
    expect(argv).toBeDefined();
    expect(argv).toEqual([
      'auth',
      'login',
      '--services',
      BUNDLES.collaboration.services.join(','),
      '--account',
      'alice@example.com',
    ]);
    // Cache invalidation must run on success.
    expect(invalidator).toHaveBeenCalledWith('alice@example.com');
    // Full happy-path progress sequence.
    expect(stages).toEqual([
      'detecting_grant',
      'launching_browser',
      'awaiting_consent',
      'persisting_token',
      'retrying_call',
    ]);
  });

  it('passes the configured consentTimeoutMs to the runner', async () => {
    const runGws = vi.fn<GwsRunnerFn>().mockResolvedValue(mkResult({ exitCode: 0 }));
    const ctx = mkCtx({ runGws, consentTimeoutMs: 7_777 });
    const { emit } = mkEmitter();

    await ensureBundleGranted({
      service: 'chat',
      account: 'alice@example.com',
      emitProgress: emit,
      ctx,
    });

    const [, options] = runGws.mock.calls[0] ?? [];
    expect(options).toEqual({ timeoutMs: 7_777 });
  });

  it('defaults to CONSENT_TIMEOUT_MS when none is supplied', async () => {
    const runGws = vi.fn<GwsRunnerFn>().mockResolvedValue(mkResult({ exitCode: 0 }));
    const ctx = mkCtx({ runGws });
    const { emit } = mkEmitter();

    await ensureBundleGranted({
      service: 'chat',
      account: 'alice@example.com',
      emitProgress: emit,
      ctx,
    });

    const [, options] = runGws.mock.calls[0] ?? [];
    expect(options).toEqual({ timeoutMs: CONSENT_TIMEOUT_MS });
  });

  it('returns denied with an ErrorEnvelope when consent is refused (exit 2)', async () => {
    const runGws = vi.fn<GwsRunnerFn>().mockResolvedValue(
      mkResult({ exitCode: 2, stderr: 'user denied consent' }),
    );
    const ctx = mkCtx({ runGws });
    const { emit, stages } = mkEmitter();

    const result = await ensureBundleGranted({
      service: 'chat',
      account: 'alice@example.com',
      emitProgress: emit,
      ctx,
    });

    expect(result.status).toBe('denied');
    if (result.status === 'denied') {
      expect(result.account).toBe('alice@example.com');
      expect(result.error.error_code).toBe('account_revoked');
      expect(result.error.gws_exit_code).toBe(2);
      expect(result.error.gws_stderr).toContain('user denied');
    }
    // Failure stage must be emitted, but not the success tail.
    expect(stages).toContain('failed_consent_denied');
    expect(stages).not.toContain('persisting_token');
    expect(stages).not.toContain('retrying_call');
  });

  it('returns failed with a gws_error envelope for a generic spawn failure (exit 1)', async () => {
    const runGws = vi.fn<GwsRunnerFn>().mockResolvedValue(
      mkResult({ exitCode: 1, stderr: 'something broke' }),
    );
    const ctx = mkCtx({ runGws });
    const { emit } = mkEmitter();

    const result = await ensureBundleGranted({
      service: 'chat',
      account: 'alice@example.com',
      emitProgress: emit,
      ctx,
    });

    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.error.error_code).toBe('gws_error');
      expect(result.error.gws_exit_code).toBe(1);
    }
  });

  it('does not invalidate cache on failure', async () => {
    const runGws = vi.fn<GwsRunnerFn>().mockResolvedValue(mkResult({ exitCode: 2 }));
    const invalidator = vi.fn<(account: string) => void>();
    const ctx = mkCtx({ runGws, invalidateGrantedCache: invalidator });
    const { emit } = mkEmitter();

    await ensureBundleGranted({
      service: 'chat',
      account: 'alice@example.com',
      emitProgress: emit,
      ctx,
    });

    expect(invalidator).not.toHaveBeenCalled();
  });
});

describe('ensureBundleGranted — concurrent OAuth (pidfile detected)', () => {
  it('returns in_progress_elsewhere without spawning when probe is true', async () => {
    const runGws = vi.fn<GwsRunnerFn>();
    const ctx = mkCtx({
      runGws,
      authInProgressProbe: stubProbe(true),
      getGrantedBundles: stubGrantedLookup(new Set()),
    });
    const { emit, stages } = mkEmitter();

    const result = await ensureBundleGranted({
      service: 'chat',
      account: 'alice@example.com',
      emitProgress: emit,
      ctx,
    });

    expect(result.status).toBe('in_progress_elsewhere');
    if (result.status === 'in_progress_elsewhere') {
      expect(result.error.error_code).toBe('auth_in_progress');
      expect(result.error.message).toMatch(/already open/);
    }
    // No login spawn.
    expect(runGws).not.toHaveBeenCalled();
    // We still emitted `detecting_grant`, but not `launching_browser`.
    expect(stages).toEqual(['detecting_grant']);
  });

  it('does not probe if the service is already granted', async () => {
    // Short-circuit path: probe never called because granted-check returns early.
    const probe = vi.fn<AuthInProgressProbe>().mockResolvedValue(true);
    const ctx = mkCtx({
      authInProgressProbe: probe,
      getGrantedBundles: stubGrantedLookup(new Set<BundleId>(['productivity'])),
    });
    const { emit } = mkEmitter();

    const result = await ensureBundleGranted({
      service: 'drive',
      account: 'alice@example.com',
      emitProgress: emit,
      ctx,
    });

    expect(result.status).toBe('granted');
    expect(probe).not.toHaveBeenCalled();
  });
});

describe('ensureBundleGranted — primary-bundle resolution', () => {
  it.each([
    ['drive', 'productivity'],
    ['chat', 'collaboration'],
    ['classroom', 'education'],
    ['slides', 'creator'],
    ['script', 'automation'],
    ['admin-reports', 'admin'],
  ] as const)(
    'uses primary bundle %s → %s when service is ungranted',
    async (service, expectedBundle) => {
      const runGws = vi.fn<GwsRunnerFn>().mockResolvedValue(mkResult({ exitCode: 0 }));
      const ctx = mkCtx({ runGws });
      const { emit } = mkEmitter();

      const result = await ensureBundleGranted({
        service,
        account: 'alice@example.com',
        emitProgress: emit,
        ctx,
      });

      expect(result.status).toBe('granted');
      if (result.status === 'granted') {
        expect(result.bundleId).toBe(expectedBundle);
      }
      const [argv] = runGws.mock.calls[0] ?? [];
      expect(argv?.[3]).toBe(BUNDLES[expectedBundle].services.join(','));
    },
  );
});
