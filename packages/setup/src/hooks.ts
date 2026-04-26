// D4: Extension seam for sibling specs (auth-probe, audit-log, ...).
//
// v2.0 ships zero registrations — pure forward-compatible stub. Future sibling
// packages (e.g. `@concierge/auth-probe`, `@concierge/audit-log`) publish their
// own probes; their packages call `registerProbe` as an import side-effect, and
// the orchestrator discovers them via `discoverExternalProbes` which scans
// `node_modules/@concierge/*-probe` and dynamic-imports each.
//
// Design notes
// ------------
// - Pure module-scope `Map` keyed by probe name. Last-write-wins on duplicate
//   registration; we emit a `console.warn` so accidental collisions are
//   visible (without throwing — sibling packages must not break setup).
// - `discoverExternalProbes` is async + best-effort. Per-package import
//   failures are recorded in the returned `errors` array but never thrown.
//   Missing `searchRoot` (ENOENT) yields a clean `{ discovered: 0, errors: [] }`
//   so v2.0 (no probes installed) is a fast no-op.
// - The orchestrator owns invocation of probes' `run()` — this module never
//   calls them directly, only registers/lists them.

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { ProbeResult } from './types/probe.js';

/** Probe function registered by an external `@concierge/*-probe` package. */
export type ExternalProbeFn = () => Promise<ProbeResult<unknown>>;

export interface ExternalProbe {
  /** Display name of the probe; used in --diagnose output. */
  name: string;
  /** Source package, e.g. '@concierge/auth-probe' (for diagnose attribution). */
  source: string;
  /** The probe function itself. */
  run: ExternalProbeFn;
}

/** Pattern matching the `@concierge/*-probe` package-name contract. */
const EXTERNAL_PROBE_PKG_PATTERN = /^@concierge\/.+-probe$/;

/** Module-scope registry. Keyed by `ExternalProbe.name`. */
const registry = new Map<string, ExternalProbe>();

/**
 * Register an external probe. Called by sibling packages on import (or via
 * dynamic discovery from `discoverExternalProbes`).
 *
 * Last-write-wins on duplicate `name`; emits a `console.warn` line so the
 * collision is visible without breaking setup.
 */
export function registerProbe(probe: ExternalProbe): void {
  const existing = registry.get(probe.name);
  if (existing) {
    console.warn(
      `[concierge-setup] probe "${probe.name}" re-registered ` +
        `(previous source: ${existing.source}, new source: ${probe.source}); last-write-wins`,
    );
  }
  registry.set(probe.name, probe);
}

/** Get all registered probes. Used by the orchestrator's diagnose phase. */
export function getRegisteredProbes(): readonly ExternalProbe[] {
  return Array.from(registry.values());
}

/** Reset registry (test-only). */
export function __resetProbesForTests(): void {
  registry.clear();
}

interface DiscoveryError {
  pkg: string;
  err: string;
}

export interface DiscoverOptions {
  /** Override the search root (test only). Defaults to packages/setup's node_modules. */
  searchRoot?: string;
  /** Logger callback for discovery diagnostics. Defaults to no-op. */
  onDiscovery?: (msg: string) => void;
}

export interface DiscoverResult {
  discovered: number;
  errors: readonly DiscoveryError[];
}

/**
 * Dynamic discovery: scan node_modules for `@concierge/*-probe` packages,
 * import each (which triggers their `registerProbe` call via side-effect).
 * Best-effort — failures per package are logged + ignored.
 *
 * v2.0 behavior: no probes exist yet, so this returns immediately having
 * found nothing. The contract is for v2.1+.
 */
export async function discoverExternalProbes(
  options: DiscoverOptions = {},
): Promise<DiscoverResult> {
  const log = options.onDiscovery ?? (() => {});
  const searchRoot = options.searchRoot ?? defaultSearchRoot();
  const scopeDir = join(searchRoot, '@concierge');

  let entries: string[];
  try {
    entries = await readdir(scopeDir);
  } catch (err) {
    // ENOENT (or any read error) at the scope root is the v2.0 happy path:
    // no `@concierge/*` deps installed. Return clean.
    log(`no @concierge scope at ${scopeDir}: ${errMessage(err)}`);
    return { discovered: 0, errors: [] };
  }

  const errors: DiscoveryError[] = [];
  let discovered = 0;

  for (const dirName of entries) {
    const pkgRoot = join(scopeDir, dirName);
    const pkgJsonPath = join(pkgRoot, 'package.json');
    let pkgJson: { name?: string; main?: string; module?: string; exports?: unknown };
    try {
      const stats = await stat(pkgRoot);
      if (!stats.isDirectory()) continue;
      const raw = await readFile(pkgJsonPath, 'utf8');
      pkgJson = JSON.parse(raw) as typeof pkgJson;
    } catch (err) {
      // Skip silently — a non-package directory or unreadable package.json is
      // not a discovery error worth surfacing.
      log(`skip ${dirName}: ${errMessage(err)}`);
      continue;
    }

    const name = pkgJson.name;
    if (typeof name !== 'string' || !EXTERNAL_PROBE_PKG_PATTERN.test(name)) {
      continue;
    }

    const entryRel = pkgJson.module ?? pkgJson.main ?? 'index.js';
    const entryAbs = join(pkgRoot, entryRel);
    const entryUrl = pathToFileURL(entryAbs).href;

    log(`importing ${name} from ${entryAbs}`);
    try {
      // Side-effect import: the probe package is expected to call
      // `registerProbe(...)` at module top-level.
      await import(entryUrl);
      discovered += 1;
    } catch (err) {
      errors.push({ pkg: name, err: errMessage(err) });
    }
  }

  return { discovered, errors };
}

function defaultSearchRoot(): string {
  // Resolve relative to this module (packages/setup/dist or src). The seam
  // is intentionally simple: the orchestrator binary is invoked from its own
  // package, so its sibling `node_modules` is the natural search root.
  // Tests inject `searchRoot` directly.
  return join(process.cwd(), 'node_modules');
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
