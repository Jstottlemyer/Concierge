// T9 — granted-bundle discovery tests (rewired for the real gws surface).
//
// gws v0.22.5 exposes only `gws auth status` (single-account). Our helpers
// therefore call `auth status` once and derive:
//   - `listAuthenticatedAccounts` → [user] if token_valid else []
//   - `getGrantedBundlesForAccount(account)` → bundles derived from scopes
//     when status.user === account && token_valid === true; else empty set.
//
// These tests cover:
//   - happy-path single-account listing
//   - exit 2 (no creds) silent-empty vs. unexpected exit warn-and-empty
//   - tolerant parsing of a `Using keyring backend: ...` preamble
//   - scopes → bundle-id mapping (incl. short-name "email"/"profile" ignored)
//   - per-account cache behavior and TTL reset via `__resetCachesForTests()`

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetCachesForTests,
  getGrantedBundlesForAccount,
  listAuthenticatedAccounts,
  type AuthLogger,
  type GwsRunnerFn,
} from '../../src/auth/granted-bundles.js';
import { BUNDLES } from '../../src/bundles/constants.js';
import type { RunResult } from '../../src/gws/runner.js';

/** Minimal RunResult factory for stubbing. */
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

/**
 * Scripted runner: returns successive results from `results` for each call.
 * If fewer results are supplied than calls happen, we return a sentinel exit
 * 99 result so an over-calling bug fails loudly.
 */
function scriptedRunner(results: readonly RunResult[]): {
  runGws: GwsRunnerFn;
  calls: string[][];
} {
  const calls: string[][] = [];
  let index = 0;
  const runGws: GwsRunnerFn = async (args) => {
    calls.push([...args]);
    if (index < results.length) {
      const result = results[index];
      index += 1;
      return result ?? mkResult({ exitCode: 99, stderr: 'undefined scripted result' });
    }
    return mkResult({ exitCode: 99, stderr: 'no scripted result remaining' });
  };
  return { runGws, calls };
}

function mkLoggerSpy(): { logger: AuthLogger; warnings: string[] } {
  const warnings: string[] = [];
  return {
    logger: {
      warn(msg: string): void {
        warnings.push(msg);
      },
    },
    warnings,
  };
}

/** Build the JSON payload gws auth status emits. */
function mkStatusJson(opts: {
  user?: string;
  token_valid?: boolean;
  scopes?: readonly string[];
  encrypted_credentials_exists?: boolean;
}): string {
  const payload: Record<string, unknown> = {};
  if (opts.user !== undefined) payload['user'] = opts.user;
  if (opts.token_valid !== undefined) payload['token_valid'] = opts.token_valid;
  if (opts.scopes !== undefined) payload['scopes'] = opts.scopes;
  if (opts.encrypted_credentials_exists !== undefined) {
    payload['encrypted_credentials_exists'] = opts.encrypted_credentials_exists;
  }
  return JSON.stringify(payload);
}

beforeEach(() => {
  __resetCachesForTests();
});

afterEach(() => {
  __resetCachesForTests();
  vi.useRealTimers();
});

describe('listAuthenticatedAccounts — gws auth status', () => {
  it('returns [user] when auth status reports a valid token', async () => {
    const { runGws, calls } = scriptedRunner([
      mkResult({
        stdout: mkStatusJson({
          user: 'alice@example.com',
          token_valid: true,
          scopes: [],
        }),
      }),
    ]);

    const accounts = await listAuthenticatedAccounts({ runGws });

    expect(accounts).toEqual(['alice@example.com']);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(['auth', 'status']);
  });

  it('returns [] when token_valid is false', async () => {
    const { runGws } = scriptedRunner([
      mkResult({
        stdout: mkStatusJson({
          user: 'alice@example.com',
          token_valid: false,
          scopes: [],
        }),
      }),
    ]);
    const { logger, warnings } = mkLoggerSpy();

    const accounts = await listAuthenticatedAccounts({ runGws, logger });

    expect(accounts).toEqual([]);
    // No warning for a "not authenticated" state — that's normal.
    expect(warnings).toEqual([]);
  });

  it('returns [] and does NOT warn on exit 2 (no credentials stored)', async () => {
    const { runGws } = scriptedRunner([
      mkResult({ exitCode: 2, stderr: 'not authenticated' }),
    ]);
    const { logger, warnings } = mkLoggerSpy();

    const accounts = await listAuthenticatedAccounts({ runGws, logger });

    expect(accounts).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('returns [] and warns on unexpected non-zero exit (exit 99)', async () => {
    const { runGws } = scriptedRunner([
      mkResult({ exitCode: 99, stderr: 'kaboom' }),
    ]);
    const { logger, warnings } = mkLoggerSpy();

    const accounts = await listAuthenticatedAccounts({ runGws, logger });

    expect(accounts).toEqual([]);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('exit 99');
  });

  it('returns [] and warns when stdout is unparseable', async () => {
    const { runGws } = scriptedRunner([
      mkResult({ stdout: 'garbage not-json at all' }),
    ]);
    const { logger, warnings } = mkLoggerSpy();

    const accounts = await listAuthenticatedAccounts({ runGws, logger });

    expect(accounts).toEqual([]);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toMatch(/unparseable/i);
  });

  it('tolerates a `Using keyring backend: ...` preamble before the JSON', async () => {
    const json = mkStatusJson({
      user: 'alice@example.com',
      token_valid: true,
      scopes: [],
    });
    const { runGws } = scriptedRunner([
      mkResult({ stdout: `Using keyring backend: keyring\n${json}` }),
    ]);

    const accounts = await listAuthenticatedAccounts({ runGws });

    expect(accounts).toEqual(['alice@example.com']);
  });

  it('caches the result within CACHE_TTL_MS; resets with __resetCachesForTests', async () => {
    const { runGws, calls } = scriptedRunner([
      mkResult({
        stdout: mkStatusJson({
          user: 'alice@example.com',
          token_valid: true,
          scopes: [],
        }),
      }),
      // Second scripted result only consumed if the cache misses.
      mkResult({
        stdout: mkStatusJson({
          user: 'alice@example.com',
          token_valid: true,
          scopes: [],
        }),
      }),
    ]);

    await listAuthenticatedAccounts({ runGws });
    await listAuthenticatedAccounts({ runGws });
    // Second call served from cache → exactly one spawn.
    expect(calls).toHaveLength(1);

    __resetCachesForTests();
    await listAuthenticatedAccounts({ runGws });
    // After reset, the helper re-queries gws.
    expect(calls).toHaveLength(2);
  });
});

describe('getGrantedBundlesForAccount — derives bundles from scopes', () => {
  it('returns productivity when the account matches and scopes cover productivity', async () => {
    const { runGws } = scriptedRunner([
      mkResult({
        stdout: mkStatusJson({
          user: 'alice@example.com',
          token_valid: true,
          scopes: BUNDLES.productivity.scopes,
        }),
      }),
    ]);

    const bundles = await getGrantedBundlesForAccount('alice@example.com', { runGws });

    expect(bundles.has('productivity')).toBe(true);
    // Collaboration scopes weren't granted.
    expect(bundles.has('collaboration')).toBe(false);
  });

  it('returns empty set when account matches but token_valid is false', async () => {
    const { runGws } = scriptedRunner([
      mkResult({
        stdout: mkStatusJson({
          user: 'alice@example.com',
          token_valid: false,
          scopes: BUNDLES.productivity.scopes,
        }),
      }),
    ]);

    const bundles = await getGrantedBundlesForAccount('alice@example.com', { runGws });

    expect(bundles.size).toBe(0);
  });

  it('returns empty set when the requested account != status.user', async () => {
    const { runGws } = scriptedRunner([
      mkResult({
        stdout: mkStatusJson({
          user: 'bob@example.com',
          token_valid: true,
          scopes: BUNDLES.productivity.scopes,
        }),
      }),
    ]);

    const bundles = await getGrantedBundlesForAccount('alice@example.com', { runGws });

    // Different account is currently authed — caller asked for alice.
    expect(bundles.size).toBe(0);
  });

  it('returns multiple bundles when scopes cover both productivity and collaboration', async () => {
    const combined = [...BUNDLES.productivity.scopes, ...BUNDLES.collaboration.scopes];
    const { runGws } = scriptedRunner([
      mkResult({
        stdout: mkStatusJson({
          user: 'alice@example.com',
          token_valid: true,
          scopes: combined,
        }),
      }),
    ]);

    const bundles = await getGrantedBundlesForAccount('alice@example.com', { runGws });

    expect(bundles.has('productivity')).toBe(true);
    expect(bundles.has('collaboration')).toBe(true);
  });

  it('ignores scope short-names like "email"/"profile"/"openid" alongside real URLs', async () => {
    const scopesWithShortNames = [
      'email',
      'profile',
      'openid',
      ...BUNDLES.productivity.scopes,
    ];
    const { runGws } = scriptedRunner([
      mkResult({
        stdout: mkStatusJson({
          user: 'alice@example.com',
          token_valid: true,
          scopes: scopesWithShortNames,
        }),
      }),
    ]);

    const bundles = await getGrantedBundlesForAccount('alice@example.com', { runGws });

    // Short-names don't match any bundle URL — productivity still granted because
    // the real URLs are present.
    expect(bundles.has('productivity')).toBe(true);
  });

  it('caches per-account: same account served from cache, different account re-queries', async () => {
    const { runGws, calls } = scriptedRunner([
      mkResult({
        stdout: mkStatusJson({
          user: 'alice@example.com',
          token_valid: true,
          scopes: BUNDLES.productivity.scopes,
        }),
      }),
      // Second spawn (for bob) — gws v0.22.5 is single-account so status still
      // returns alice, meaning bob's bundle set will be empty.
      mkResult({
        stdout: mkStatusJson({
          user: 'alice@example.com',
          token_valid: true,
          scopes: BUNDLES.productivity.scopes,
        }),
      }),
    ]);

    const alice1 = await getGrantedBundlesForAccount('alice@example.com', { runGws });
    expect(alice1.has('productivity')).toBe(true);
    expect(calls).toHaveLength(1);

    // Same-account second call → served from cache, no new spawn.
    const alice2 = await getGrantedBundlesForAccount('alice@example.com', { runGws });
    expect(alice2.has('productivity')).toBe(true);
    expect(calls).toHaveLength(1);

    // Different account → cache miss → new spawn.
    const bob = await getGrantedBundlesForAccount('bob@example.com', { runGws });
    expect(bob.size).toBe(0);
    expect(calls).toHaveLength(2);
  });

  it('expires cache entries past CACHE_TTL_MS', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

    const { runGws, calls } = scriptedRunner([
      mkResult({
        stdout: mkStatusJson({
          user: 'alice@example.com',
          token_valid: true,
          scopes: BUNDLES.productivity.scopes,
        }),
      }),
      mkResult({
        stdout: mkStatusJson({
          user: 'alice@example.com',
          token_valid: true,
          scopes: BUNDLES.productivity.scopes,
        }),
      }),
    ]);

    await getGrantedBundlesForAccount('alice@example.com', { runGws });
    // Advance past the 30s TTL.
    vi.setSystemTime(new Date('2025-01-01T00:01:00Z'));
    await getGrantedBundlesForAccount('alice@example.com', { runGws });

    expect(calls).toHaveLength(2);
  });

  it('returns empty set when auth status exits 2 (no creds)', async () => {
    const { runGws } = scriptedRunner([
      mkResult({ exitCode: 2, stderr: 'not authenticated' }),
    ]);
    const { logger, warnings } = mkLoggerSpy();

    const bundles = await getGrantedBundlesForAccount('alice@example.com', {
      runGws,
      logger,
    });

    expect(bundles.size).toBe(0);
    expect(warnings).toEqual([]);
  });
});
