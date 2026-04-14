// T9 — Auto-consent orchestrator.
//
// When a tool is invoked whose service's bundle hasn't been granted yet, this
// flow:
//
//   1. Emits `detecting_grant` progress.
//   2. Queries granted bundles for the account (via `getGrantedBundlesForAccount`).
//   3. If any granted bundle already contains the service → returns `granted`
//      immediately (no consent needed; caller retries).
//   4. Otherwise resolves the service's primary bundle.
//   5. Checks the pidfile probe (T10): if another `gws auth login` is in flight
//      → returns `in_progress_elsewhere`.
//   6. Emits `launching_browser` with bundle display name + scope count.
//   7. Spawns `gws auth login --services <comma-separated-bundle-services>`.
//   8. Emits `awaiting_consent`.
//   9. Awaits subprocess completion.
//  10. On exit 0: emits `persisting_token`, invalidates the granted-bundles
//      cache, emits `retrying_call`, returns `granted`.
//  11. On non-zero exit: emits `failed_consent_denied`, translates the result
//      into an ErrorEnvelope via `toolErrorFromGwsResult`, and returns either
//      `denied` (for exit 2 = account/consent problem) or `failed` otherwise.
//
// ### Coordination with T10 (concurrent OAuth detect-and-defer)
//
// The pidfile probe lives in T10 (`~/.config/gws/auth.pid`). Until T10 lands,
// tests use a stub probe. The interface is minimal — a function returning
// `Promise<boolean>` — so T10 only has to provide an implementation.
//
// ### Subprocess timeout
//
// The login flow is user-driven — browser consent can take minutes. We use a
// generous 5-minute timeout (`CONSENT_TIMEOUT_MS`) distinct from the runner's
// default 30s. Callers can override via `ctx.consentTimeoutMs`.

import { makeError, type ErrorEnvelope } from '@concierge/core/errors';
import { toolErrorFromGwsResult } from '../gws/errors.js';
import { BUNDLES } from '../bundles/constants.js';
import { getPrimaryBundleForService } from '../bundles/resolution.js';
import type { BundleDef, BundleId, Service } from '../bundles/types.js';
import type { ProgressEmitter } from '../mcp/progress.js';
import {
  __resetCachesForTests as resetGrantedCachesForTests,
  type GrantedBundlesContext,
  type GwsRunnerFn,
} from './granted-bundles.js';

/**
 * Probe for whether another `gws auth login` is currently in flight on this
 * machine. Returns `true` if so; `false` otherwise.
 *
 * T10 (`~/.config/gws/auth.pid`) provides the real implementation. Tests use
 * a stub returning true/false. Intentionally simple — no pidfile details leak
 * into the consent-flow contract.
 */
export type AuthInProgressProbe = () => Promise<boolean>;

/**
 * Invalidator for cached granted-bundle results. After a successful consent we
 * must forget the pre-consent view so the next query picks up the new grant.
 *
 * Injected rather than calling `__resetCachesForTests` directly so production
 * can wire a narrower invalidator (e.g., per-account eviction) if desired.
 * Defaults to the module-wide reset.
 */
export type GrantedCacheInvalidator = (account: string) => void;

/**
 * Lookup function for the account's currently-granted bundles. Matches the
 * signature of `getGrantedBundlesForAccount` so callers can pass it directly.
 */
export type GrantedBundlesLookup = (
  account: string,
  ctx: GrantedBundlesContext,
) => Promise<ReadonlySet<BundleId>>;

/** Context bundle for `ensureBundleGranted`. All dependencies injected. */
export interface ConsentContext {
  readonly runGws: GwsRunnerFn;
  readonly authInProgressProbe: AuthInProgressProbe;
  readonly getGrantedBundles: GrantedBundlesLookup;
  readonly invalidateGrantedCache?: GrantedCacheInvalidator;
  readonly consentTimeoutMs?: number;
}

/**
 * Outcome of `ensureBundleGranted`. Discriminated by `status` so callers can
 * pattern-match without introspection.
 */
export type ConsentResult =
  | { readonly status: 'granted'; readonly bundleId: BundleId; readonly account: string }
  | { readonly status: 'denied'; readonly account: string; readonly error: ErrorEnvelope }
  | { readonly status: 'in_progress_elsewhere'; readonly error: ErrorEnvelope }
  | { readonly status: 'failed'; readonly error: ErrorEnvelope };

/** Parameters to `ensureBundleGranted`. */
export interface EnsureBundleGrantedParams {
  readonly service: Service;
  /** Caller resolves `default_account` upstream and passes the concrete email. */
  readonly account: string;
  readonly emitProgress: ProgressEmitter;
  readonly ctx: ConsentContext;
}

/** 5-minute default timeout for the consent subprocess (user-driven wait). */
export const CONSENT_TIMEOUT_MS = 5 * 60 * 1000;

/** Exit code gws uses for consent denial / account revoked. */
const CONSENT_DENIED_EXIT_CODE = 2;

/**
 * Ensure the caller's service has a granted bundle covering it, triggering an
 * OAuth consent flow if not. See module header for the full 11-step contract.
 */
export async function ensureBundleGranted(
  params: EnsureBundleGrantedParams,
): Promise<ConsentResult> {
  const { service, account, emitProgress, ctx } = params;

  // --- Step 1: detect existing grant. -----------------------------------
  await emitProgress('detecting_grant', { account });

  const granted = await ctx.getGrantedBundles(account, { runGws: ctx.runGws });

  // --- Step 2: shortcut if any granted bundle contains the service. -----
  const existing = findGrantedBundleForService(service, granted);
  if (existing !== null) {
    return { status: 'granted', bundleId: existing, account };
  }

  // --- Step 3: resolve primary bundle for the uncovered service. --------
  const bundleId = getPrimaryBundleForService(service);
  const bundle: BundleDef = BUNDLES[bundleId];

  // --- Step 4: check for another consent flow in progress. --------------
  const inFlight = await ctx.authInProgressProbe();
  if (inFlight) {
    return {
      status: 'in_progress_elsewhere',
      error: makeError({
        error_code: 'auth_in_progress',
        message:
          `Another Google sign-in window is already open. Finish that consent flow, ` +
          `then retry this call.`,
      }),
    };
  }

  // --- Step 5: spawn gws auth login with the bundle's services. ---------
  const servicesArg = bundle.services.join(',');
  await emitProgress('launching_browser', {
    account,
    bundleDisplay: bundle.displayName,
    scopeCount: bundle.scopes.length,
  });
  await emitProgress('awaiting_consent', {
    account,
    bundleDisplay: bundle.displayName,
  });

  const timeoutMs = ctx.consentTimeoutMs ?? CONSENT_TIMEOUT_MS;
  const result = await ctx.runGws(
    ['auth', 'login', '--services', servicesArg, '--account', account],
    { timeoutMs },
  );

  // --- Step 6: success → invalidate cache, emit final stages, return. ---
  if (result.exitCode === 0) {
    const invalidate = ctx.invalidateGrantedCache ?? defaultInvalidator;
    invalidate(account);

    await emitProgress('persisting_token', { account, bundleDisplay: bundle.displayName });
    await emitProgress('retrying_call', { account, bundleDisplay: bundle.displayName });

    return { status: 'granted', bundleId, account };
  }

  // --- Step 7: failure → translate + emit failure stage. ----------------
  await emitProgress('failed_consent_denied', { account, bundleDisplay: bundle.displayName });

  const envelope = toolErrorFromGwsResult(result);

  // Exit 2 = consent denied / account revoked; surface as `denied` so the
  // caller can distinguish a user-driven refusal from a transport failure.
  if (result.exitCode === CONSENT_DENIED_EXIT_CODE) {
    return { status: 'denied', account, error: envelope };
  }
  return { status: 'failed', error: envelope };
}

/**
 * Default cache invalidator — clears the module-wide granted-bundles map.
 * Production callers may pass a narrower invalidator via `ctx.invalidateGrantedCache`.
 */
function defaultInvalidator(_account: string): void {
  resetGrantedCachesForTests();
}

/**
 * Return a granted bundle id that contains the given service, or `null` if
 * none does. First match wins — order within the granted set is not meaningful.
 */
function findGrantedBundleForService(
  service: Service,
  granted: ReadonlySet<BundleId>,
): BundleId | null {
  for (const bundleId of granted) {
    const bundle: BundleDef = BUNDLES[bundleId];
    if (bundle.services.includes(service)) {
      return bundleId;
    }
  }
  return null;
}
