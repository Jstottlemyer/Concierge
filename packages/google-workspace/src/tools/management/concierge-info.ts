// concierge_info — management tool.
//
// Returns a snapshot of every version/string a user might need to diagnose
// what Concierge installation they actually have on disk. Covers:
//   - Vendor package (this one) name + version.
//   - @concierge/core version (the shared foundation library).
//   - Bundled gws binary version + sha256 + resolved path.
//   - Node runtime version / platform / arch.
//   - Manifest version + MCPB manifest_version.
//
// Readonly: true. No state mutation, no subprocess beyond the (already-cached)
// `gws --version` call. Safe to invoke repeatedly.
//
// Getting versions at runtime inside a bundled server:
//   - Vendor + core versions are injected via tsup `define` (see tsup.config.ts).
//     The substituted values are string literals baked into dist/index.js at
//     build time. In dev (vitest / ts-node), the `__CONCIERGE_*_VERSION__`
//     identifiers aren't defined; we gate reads through `typeof ... !==
//     'undefined'` and fall back to reading the local package.json files
//     relative to this source file.
//   - Manifest is read from the bundle root (two levels up from this module
//     when bundled to dist/index.js, same relative offset as resolveGwsBinary).
//   - gws binary sha256 is computed lazily on first call; cached afterwards.
//
// Description: conforms to Decision #13.5 (Concierge tool description style —
// start with what the tool returns, explain the scenario-triggered use).

import { z } from 'zod/v3';
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

import { resolveGwsBinary } from '../../gws/paths.js';
import { getGwsVersion } from '../../gws/runner.js';
import type { ToolContext, ToolDef, ToolResult } from '../types.js';

// --------------------------------------------------------------------------
// Schemas
// --------------------------------------------------------------------------

export const ConciergeInfoInputSchema = z.object({}).strict();

export type ConciergeInfoInput = z.infer<typeof ConciergeInfoInputSchema>;

const ConciergeSection = z
  .object({
    vendor_package: z.string(),
    vendor_version: z.string(),
    core_version: z.string(),
    build_time: z.string(),
    build_id: z.string(),
  })
  .strict();

const GwsSection = z
  .object({
    version: z.string(),
    binary_sha256: z.string(),
    binary_path: z.string(),
  })
  .strict();

const RuntimeSection = z
  .object({
    node: z.string(),
    platform: z.string(),
    arch: z.string(),
  })
  .strict();

const ManifestSection = z
  .object({
    version: z.string(),
    mcp_manifest_version: z.string(),
  })
  .strict();

export const ConciergeInfoOutputSchema = z
  .object({
    concierge: ConciergeSection,
    gws: GwsSection,
    runtime: RuntimeSection,
    manifest: ManifestSection,
  })
  .strict();

export type ConciergeInfoOutput = z.infer<typeof ConciergeInfoOutputSchema>;

// --------------------------------------------------------------------------
// Version resolution — build-time injection with dev-fallback
// --------------------------------------------------------------------------

/**
 * Read the vendor package version. In a bundled build, the tsup `define`
 * substitutes `__CONCIERGE_VENDOR_VERSION__` with a string literal. In dev
 * (no substitution), fall back to reading the package.json next to the
 * source tree.
 */
function readVendorVersion(): string {
  if (typeof __CONCIERGE_VENDOR_VERSION__ !== 'undefined') {
    return __CONCIERGE_VENDOR_VERSION__;
  }
  return readSiblingPackageJsonVersion('../../../package.json');
}

/**
 * Read the @concierge/core package version. Mirror of `readVendorVersion`
 * but pointing at the core package.json via the workspace.
 */
function readCoreVersion(): string {
  if (typeof __CONCIERGE_CORE_VERSION__ !== 'undefined') {
    return __CONCIERGE_CORE_VERSION__;
  }
  // From src/tools/management/concierge-info.ts → up to package root → up to
  // packages/ → down into core/package.json.
  return readSiblingPackageJsonVersion('../../../../core/package.json');
}

function readSiblingPackageJsonVersion(relPath: string): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const resolved = path.resolve(here, relPath);
    const raw = readFileSync(resolved, 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Read the build-stamp time. Baked via tsup `define` in production; dev/test
 * runs return a sentinel so downstream consumers can still rely on a non-empty
 * string without forcing a build step.
 */
function readBuildTime(): string {
  if (typeof __CONCIERGE_BUILD_TIME__ !== 'undefined') {
    return __CONCIERGE_BUILD_TIME__;
  }
  return 'dev-unbuilt';
}

/** Mirror of `readBuildTime` for the 8-char build ID. */
function readBuildId(): string {
  if (typeof __CONCIERGE_BUILD_ID__ !== 'undefined') {
    return __CONCIERGE_BUILD_ID__;
  }
  return 'devbuild';
}

// --------------------------------------------------------------------------
// Manifest resolution
// --------------------------------------------------------------------------

interface ManifestShape {
  version: string;
  manifest_version: string;
}

/**
 * Read manifest.json. In a bundled build, the file sits next to dist/ at the
 * package root. In dev, the same two-level climb from `src/tools/management/`
 * (→ `src/tools/` → `src/` → package root) doesn't reach manifest.json; we
 * try the compiled layout first and fall back to the dev layout.
 */
function readManifest(): ManifestShape {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Compiled: here = <pkg>/dist; manifest.json lives at <pkg>/manifest.json.
  const compiledCandidate = path.resolve(here, '..', 'manifest.json');
  // Dev: here = <pkg>/src/tools/management; manifest.json at <pkg>/manifest.json.
  const devCandidate = path.resolve(here, '..', '..', '..', 'manifest.json');
  for (const candidate of [compiledCandidate, devCandidate]) {
    try {
      const raw = readFileSync(candidate, 'utf8');
      const parsed = JSON.parse(raw) as ManifestShape;
      if (typeof parsed.version === 'string' && typeof parsed.manifest_version === 'string') {
        return parsed;
      }
    } catch {
      // Try next candidate.
    }
  }
  return { version: 'unknown', manifest_version: 'unknown' };
}

// --------------------------------------------------------------------------
// gws sha256 — cache per process; mirrors the version-cache pattern in runner.
// --------------------------------------------------------------------------

interface GwsBinaryFacts {
  readonly path: string;
  readonly sha256: string;
}

let cachedGwsBinaryFacts: GwsBinaryFacts | null = null;

async function getGwsBinaryFacts(): Promise<GwsBinaryFacts> {
  if (cachedGwsBinaryFacts !== null) return cachedGwsBinaryFacts;

  let resolvedPath = 'unknown';
  let sha = 'unknown';
  try {
    resolvedPath = resolveGwsBinary();
    sha = await hashFileSha256(resolvedPath);
  } catch {
    // Leave the fallback placeholders in place — the tool should never throw
    // from info collection. The caller learns "unknown" means the binary
    // couldn't be resolved in the current environment.
  }
  cachedGwsBinaryFacts = { path: resolvedPath, sha256: sha };
  return cachedGwsBinaryFacts;
}

function hashFileSha256(absPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(absPath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/** Test-only helper: drop the sha256 cache so a fresh compute runs next call. */
export function __resetConciergeInfoCachesForTests(): void {
  cachedGwsBinaryFacts = null;
}

// --------------------------------------------------------------------------
// Tool definition
// --------------------------------------------------------------------------

export const CONCIERGE_INFO_DESCRIPTION =
  'Reports installed Concierge versions (including build_time + build_id so you can tell whether ' +
  'the running .mcpb is the latest build), the bundled gws binary identity (version + sha256 + ' +
  'resolved path), Node runtime info, and manifest schema version. Use when the user asks which ' +
  'version of Concierge is installed, when debugging a bug report, or when verifying the .mcpb ' +
  'bundle matches a known release. Read-only and safe to call repeatedly.';

async function invoke(
  _args: ConciergeInfoInput,
  _ctx: ToolContext,
): Promise<ToolResult<ConciergeInfoOutput>> {
  void _args;
  void _ctx;

  const vendorVersion = readVendorVersion();
  const coreVersion = readCoreVersion();
  const buildTime = readBuildTime();
  const buildId = readBuildId();
  const manifest = readManifest();

  let gwsVersion = 'unknown';
  try {
    gwsVersion = await getGwsVersion();
  } catch {
    // Non-fatal — we still return a well-formed envelope with version=unknown.
  }

  const gwsFacts = await getGwsBinaryFacts();

  const output: ConciergeInfoOutput = {
    concierge: {
      vendor_package: '@concierge/google-workspace',
      vendor_version: vendorVersion,
      core_version: coreVersion,
      build_time: buildTime,
      build_id: buildId,
    },
    gws: {
      version: gwsVersion,
      binary_sha256: gwsFacts.sha256,
      binary_path: gwsFacts.path,
    },
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    manifest: {
      version: manifest.version,
      mcp_manifest_version: manifest.manifest_version,
    },
  };

  return { ok: true, data: output };
}

export const conciergeInfo: ToolDef<ConciergeInfoInput, ConciergeInfoOutput> = {
  name: 'concierge_info',
  description: CONCIERGE_INFO_DESCRIPTION,
  service: 'management',
  readonly: true,
  input: ConciergeInfoInputSchema,
  output: ConciergeInfoOutputSchema,
  invoke,
};
