// C9: Daily-cached GitHub Releases poll for newer Concierge versions.
//
// Per spec D11 + locked OQ #2: the orchestrator polls
// `api.github.com/repos/Jstottlemyer/Concierge/releases/latest` once per
// 24 hours to detect newer Concierge releases. The result is cached in
// `~/.config/concierge/.update-check` and surfaced in the run banner.
//
// Design constraints
// ------------------
// - Best-effort only. The check MUST NOT be load-bearing: every failure
//   mode (cache I/O error, DNS failure, TCP refused, HTTP timeout, 4xx,
//   rate-limit, malformed JSON, unparseable tag) returns a benign
//   `{ newer: false, skipReason: ... }` instead of throwing.
// - GET-only against a public endpoint. No auth header (60 req/hr unauth
//   limit is plenty for a daily check). No body sent — this is the
//   "no telemetry" reconciliation in OQ #2.
// - Cache TTL is mtime-based to avoid clock-skew between writer and reader
//   on the same machine being a problem.
// - Atomic cache writes: write to `<path>.tmp` + rename so a crash mid-
//   write never leaves a half-written cache.
// - Disabled mode (`CONCIERGE_SETUP_UPDATE_CHECK=0`) short-circuits before
//   any I/O — useful for offline CI and tests.
// - No new deps: hand-rolled semver compare. We only need "is A newer
//   than B" for `MAJOR.MINOR.PATCH[-prerelease]` shapes; pulling in
//   `node-semver` for that is overkill.

import { readFile, rename, stat, writeFile, mkdir } from 'node:fs/promises';
import * as os from 'node:os';
import { dirname, join } from 'node:path';

export interface UpdateCheckResult {
  /** True if a newer version is available. */
  newer: boolean;
  /** Latest version tag from the GitHub API, e.g. "release-v0.4.0" or "v0.4.0". */
  latestTag?: string | undefined;
  /** Where the user can read more (release URL). */
  releaseUrl?: string | undefined;
  /** Reason if check was skipped (cache hit, rate-limited, network error, etc.). */
  skipReason?:
    | 'cache-hit'
    | 'rate-limited'
    | 'network-error'
    | 'parse-error'
    | 'check-disabled'
    | undefined;
}

export interface UpdateCheckOptions {
  /** Current version of @concierge/setup running. */
  currentVersion: string;
  /** Path to the cache file. Defaults to ~/.config/concierge/.update-check */
  cachePath?: string | undefined;
  /** Override the API URL (test only). */
  apiUrl?: string | undefined;
  /** TTL for the cache in ms. Default: 24 * 60 * 60 * 1000 (24h). */
  cacheTtlMs?: number | undefined;
  /** Hard timeout on the HTTP request (ms). Default: 3000. */
  timeoutMs?: number | undefined;
}

interface CachePayload {
  checkedAt: string; // ISO-8601
  latestTag?: string | undefined;
  releaseUrl?: string | undefined;
  currentVersion: string;
  newer: boolean;
}

const DEFAULT_API_URL =
  'https://api.github.com/repos/Jstottlemyer/Concierge/releases/latest';
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 3000;

function defaultCachePath(): string {
  return join(os.homedir(), '.config', 'concierge', '.update-check');
}

/**
 * Strip a leading "v" or "release-v" prefix and any leading non-digit chars
 * before the first numeric component. Returns the remaining string (which
 * may still contain a `-prerelease` suffix).
 */
function stripTagPrefix(tag: string): string {
  // e.g. "release-v0.4.0" → "0.4.0", "v1.2.3-rc.1" → "1.2.3-rc.1".
  const m = /(\d.*)$/.exec(tag);
  return m && m[1] !== undefined ? m[1] : tag;
}

/**
 * Parse a `MAJOR.MINOR.PATCH[-prerelease]` string into a comparable tuple.
 * Returns `null` if the string does not start with three numeric components.
 *
 * Comparison semantics:
 *   - higher MAJOR/MINOR/PATCH → newer.
 *   - prerelease tags (`-rc.1`) sort BEFORE the same `MAJOR.MINOR.PATCH`
 *     without any prerelease (semver §11), so `1.0.0-rc.1` < `1.0.0`.
 */
function parseSemverish(
  raw: string,
): { major: number; minor: number; patch: number; pre: string | null } | null {
  const stripped = stripTagPrefix(raw);
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(stripped);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] ?? null,
  };
}

/**
 * Returns true iff `latest` is strictly newer than `current`. Returns false
 * if either string is unparseable (conservative — we never want to
 * false-positive a "new version" notice on garbage).
 */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseSemverish(latest);
  const b = parseSemverish(current);
  if (!a || !b) return false;
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  if (a.patch !== b.patch) return a.patch > b.patch;
  // Same MAJOR.MINOR.PATCH. A non-prerelease is newer than a prerelease.
  if (a.pre === null && b.pre !== null) return true;
  if (a.pre !== null && b.pre === null) return false;
  if (a.pre !== null && b.pre !== null) return a.pre > b.pre;
  return false;
}

async function readCache(cachePath: string): Promise<CachePayload | null> {
  try {
    const raw = await readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as CachePayload;
    if (typeof parsed.newer !== 'boolean') return null;
    return parsed;
  } catch {
    return null;
  }
}

async function cacheIsFresh(cachePath: string, ttlMs: number): Promise<boolean> {
  try {
    const st = await stat(cachePath);
    return Date.now() - st.mtimeMs < ttlMs;
  } catch {
    return false;
  }
}

async function writeCacheAtomic(
  cachePath: string,
  payload: CachePayload,
): Promise<void> {
  try {
    await mkdir(dirname(cachePath), { recursive: true });
    const tmp = `${cachePath}.tmp`;
    await writeFile(tmp, JSON.stringify(payload), 'utf8');
    await rename(tmp, cachePath);
  } catch {
    // Cache writes are best-effort. Swallow.
  }
}

/**
 * Race a promise against a hard timeout. Returns `{ ok: true, value }` on
 * resolution, `{ ok: false }` on timeout. The original promise is not
 * cancelled (that requires AbortController on the caller side).
 */
function withTimeout<T>(
  p: Promise<T>,
  timeoutMs: number,
  abort: AbortController,
): Promise<{ ok: true; value: T } | { ok: false }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      abort.abort();
      resolve({ ok: false });
    }, timeoutMs);
    p.then(
      (value) => {
        clearTimeout(timer);
        resolve({ ok: true, value });
      },
      () => {
        clearTimeout(timer);
        resolve({ ok: false });
      },
    );
  });
}

export async function checkForUpdate(
  options: UpdateCheckOptions,
): Promise<UpdateCheckResult> {
  if (process.env['CONCIERGE_SETUP_UPDATE_CHECK'] === '0') {
    return { newer: false, skipReason: 'check-disabled' };
  }

  const {
    currentVersion,
    cachePath = defaultCachePath(),
    apiUrl = DEFAULT_API_URL,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  // Cache check first. mtime-based TTL avoids needing clock parsing of the
  // checkedAt field; payload is still trusted for the `newer` bit.
  if (await cacheIsFresh(cachePath, cacheTtlMs)) {
    const cached = await readCache(cachePath);
    if (cached) {
      return {
        newer: cached.newer,
        latestTag: cached.latestTag,
        releaseUrl: cached.releaseUrl,
        skipReason: 'cache-hit',
      };
    }
    // Fresh-but-unreadable cache → fall through to HTTP, do not error.
  }

  // HTTP fetch with a hard timeout. AbortController is necessary so the
  // socket actually closes when we time out (otherwise the test process
  // hangs waiting for an open keep-alive connection at exit).
  const abort = new AbortController();
  const fetched = await withTimeout(
    fetch(apiUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `concierge-setup/${currentVersion}`,
      },
      signal: abort.signal,
    }),
    timeoutMs,
    abort,
  );

  if (!fetched.ok) {
    return { newer: false, skipReason: 'network-error' };
  }

  const response = fetched.value;

  // Rate-limit handling: GitHub returns 403 with `X-RateLimit-Remaining: 0`
  // (or 429 in some edge cases). Either signal means "back off, try again
  // tomorrow." Don't cache — the cache TTL would suppress retry too long.
  const remaining = response.headers.get('x-ratelimit-remaining');
  if (response.status === 403 || response.status === 429 || remaining === '0') {
    return { newer: false, skipReason: 'rate-limited' };
  }

  if (!response.ok) {
    // Other 4xx/5xx — treat as transient network error, don't cache.
    return { newer: false, skipReason: 'network-error' };
  }

  // Parse. GitHub release shape: { tag_name: string, html_url: string, ... }.
  let body: { tag_name?: unknown; html_url?: unknown };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    return { newer: false, skipReason: 'parse-error' };
  }

  const latestTag = typeof body.tag_name === 'string' ? body.tag_name : undefined;
  const releaseUrl =
    typeof body.html_url === 'string' ? body.html_url : undefined;

  if (!latestTag) {
    return { newer: false, skipReason: 'parse-error' };
  }

  const newer = isNewerVersion(latestTag, currentVersion);
  const result: UpdateCheckResult = { newer, latestTag, releaseUrl };

  await writeCacheAtomic(cachePath, {
    checkedAt: new Date().toISOString(),
    latestTag,
    releaseUrl,
    currentVersion,
    newer,
  });

  return result;
}
