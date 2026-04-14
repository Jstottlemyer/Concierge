// T9 — Granted-bundle discovery helpers, rewired against the REAL gws auth
// surface (v0.22.5+).
//
// Empirical discovery (post-build, 2026-04-14): gws has `auth status` (not
// `auth list`) and `auth export` (no `--scopes-only`, no `--all`). It is
// effectively single-account in v0.22.5 — one credentials.enc, one user at a
// time. Our multi-account design in the spec is aspirational; it will light up
// when gws gains multi-account support. Until then:
//
//   - `listAuthenticatedAccounts()` → runs `gws auth status`; if valid, returns
//     the one user email; else [].
//   - `getGrantedBundlesForAccount(account)` → runs `gws auth status`; if the
//     reported user matches `account`, derive granted bundles from the
//     `scopes` array; otherwise the account isn't currently authenticated
//     (returns empty set — consent flow will prompt).
//
// Subprocess calls go through an injected `GwsRunnerFn`. That indirection
// keeps this module unit-testable without mocking child_process — tests pass
// a stub runner.
//
// Caching: per-process, 30s TTL so repeated tool calls inside a single session
// don't re-spawn gws. Tests clear via `__resetCachesForTests()`.

import { BUNDLES } from '../bundles/constants.js';
import type { BundleId } from '../bundles/types.js';
import type { RunOptions, RunResult } from '../gws/runner.js';

/**
 * Signature of the gws runner injected into auth helpers. Matches `runGws`
 * from `src/gws/runner.ts` so callers can pass it directly.
 */
export type GwsRunnerFn = (
  args: readonly string[],
  options?: RunOptions,
) => Promise<RunResult>;

/** Minimal stderr-logger interface. Tests pass a spy; prod passes `console`. */
export interface AuthLogger {
  warn(message: string): void;
}

/** Default logger — writes warnings to stderr so MCP stdout framing stays clean. */
const defaultLogger: AuthLogger = {
  warn(message: string): void {
    process.stderr.write(`[concierge warn] ${message}\n`);
  },
};

/** Context object accepted by granted-bundle helpers. */
export interface GrantedBundlesContext {
  readonly runGws: GwsRunnerFn;
  readonly logger?: AuthLogger;
}

/** TTL for cached results (milliseconds). */
export const CACHE_TTL_MS = 30_000;

interface GrantedCacheEntry {
  readonly bundles: ReadonlySet<BundleId>;
  readonly timestamp: number;
}

interface AccountsCacheEntry {
  readonly accounts: readonly string[];
  readonly timestamp: number;
}

const grantedCache = new Map<string, GrantedCacheEntry>();
let accountsCache: AccountsCacheEntry | null = null;

export function __resetCachesForTests(): void {
  grantedCache.clear();
  accountsCache = null;
}

function now(): number {
  return Date.now();
}

/**
 * Parsed shape of `gws auth status` stdout (partial — we only care about a
 * few fields). Unknown fields ignored.
 */
interface GwsAuthStatus {
  readonly user?: string;
  readonly scopes?: readonly string[];
  readonly token_valid?: boolean;
  readonly encrypted_credentials_exists?: boolean;
}

/**
 * Return the set of bundle IDs the given account has been granted.
 *
 * Contract:
 *   - Empty set = "no granted bundles we could detect" (conservative; triggers consent).
 *   - Never throws.
 *   - Cached per-account for `CACHE_TTL_MS` (30s).
 */
export async function getGrantedBundlesForAccount(
  account: string,
  ctx: GrantedBundlesContext,
): Promise<ReadonlySet<BundleId>> {
  const cached = grantedCache.get(account);
  if (cached !== undefined && now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.bundles;
  }

  const logger = ctx.logger ?? defaultLogger;
  const status = await readAuthStatus(ctx.runGws, logger);

  let scopes: readonly string[] = [];
  if (status !== null && status.user === account && status.token_valid === true) {
    scopes = status.scopes ?? [];
  }

  const bundles = scopesToBundleSet(scopes);
  grantedCache.set(account, { bundles, timestamp: now() });
  return bundles;
}

/**
 * List authenticated accounts gws currently holds credentials for. Single-
 * account in v0.22.5 — returns [user] if `auth status` reports a valid token,
 * [] otherwise.
 */
export async function listAuthenticatedAccounts(
  ctx: GrantedBundlesContext,
): Promise<readonly string[]> {
  if (accountsCache !== null && now() - accountsCache.timestamp < CACHE_TTL_MS) {
    return accountsCache.accounts;
  }

  const logger = ctx.logger ?? defaultLogger;
  const status = await readAuthStatus(ctx.runGws, logger);

  const accounts: readonly string[] =
    status !== null && status.token_valid === true && typeof status.user === 'string'
      ? [status.user]
      : [];

  accountsCache = { accounts, timestamp: now() };
  return accounts;
}

// ---------- internals ----------

/**
 * Run `gws auth status` and parse its JSON. Returns the parsed shape on
 * success, `null` on any failure (subprocess error, parse error, unexpected
 * shape). Logs a single-line warning on failure paths.
 */
async function readAuthStatus(
  runGws: GwsRunnerFn,
  logger: AuthLogger,
): Promise<GwsAuthStatus | null> {
  let result: RunResult;
  try {
    result = await runGws(['auth', 'status']);
  } catch (err) {
    logger.warn(
      `gws auth status spawn failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }

  if (result.exitCode !== 0) {
    // exit 2 is normal when no credentials are stored yet — treat as "no auth".
    if (result.exitCode !== 2) {
      logger.warn(
        `gws auth status exit ${String(result.exitCode)}: ${truncate(result.stderr, 200)}`,
      );
    }
    return null;
  }

  const parsed = parseAuthStatusJson(result.stdout);
  if (parsed === null) {
    logger.warn(`gws auth status returned unparseable output`);
    return null;
  }
  return parsed;
}

/**
 * Parse `gws auth status` stdout. The command emits a single JSON object;
 * tolerate a leading `Using keyring backend: ...` line if the runner didn't
 * strip it (our runner doesn't).
 */
function parseAuthStatusJson(stdout: string): GwsAuthStatus | null {
  const trimmed = stdout.trim();
  if (trimmed.length === 0) return null;

  // Find the first `{` (skip any preamble like "Using keyring backend: keyring").
  const objStart = trimmed.indexOf('{');
  if (objStart < 0) return null;
  const jsonPortion = trimmed.slice(objStart);

  const parsed = tryParseJson(jsonPortion);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;

  // Shape-check: we care about `user`, `scopes`, `token_valid`,
  // `encrypted_credentials_exists`. All optional — presence-based.
  const status: GwsAuthStatus = {};
  if (typeof record['user'] === 'string') {
    (status as { user?: string }).user = record['user'];
  }
  const scopes = record['scopes'];
  if (Array.isArray(scopes) && scopes.every((v) => typeof v === 'string')) {
    (status as { scopes?: readonly string[] }).scopes = scopes as string[];
  }
  if (typeof record['token_valid'] === 'boolean') {
    (status as { token_valid?: boolean }).token_valid = record['token_valid'];
  }
  if (typeof record['encrypted_credentials_exists'] === 'boolean') {
    (status as { encrypted_credentials_exists?: boolean }).encrypted_credentials_exists =
      record['encrypted_credentials_exists'];
  }
  return status;
}

/** `JSON.parse` that never throws. */
function tryParseJson(input: string): unknown {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return null;
  }
}

/**
 * Given a set of granted OAuth scope URLs (or short names like "email"/"profile"
 * that gws reports as-is), determine which bundles are fully covered. A bundle
 * is granted iff every scope in its definition is present in the granted-scopes
 * set. Scope short-names reported by gws ("email", "profile", "openid") never
 * match our bundle URLs and are simply ignored.
 */
function scopesToBundleSet(scopes: readonly string[]): ReadonlySet<BundleId> {
  const granted = new Set<string>(scopes);
  const result = new Set<BundleId>();
  for (const bundle of Object.values(BUNDLES)) {
    if (bundle.scopes.every((scope) => granted.has(scope))) {
      result.add(bundle.id);
    }
  }
  return result;
}

function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max)}...`;
}
