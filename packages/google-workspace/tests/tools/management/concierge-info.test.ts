// concierge_info tests.
//
// Exercises the diagnostic tool that reports Concierge/core/gws/runtime
// versions. The key invariants:
//   - Returns a well-formed envelope on the happy path (gws binary present
//     via CONCIERGE_GWS_BIN override or fallback).
//   - Vendor + core versions come from package.json reads (dev) or
//     tsup-injected defines (bundled) — either path produces a non-empty
//     string.
//   - Manifest reads work from the dev layout.
//   - Missing gws binary degrades gracefully to 'unknown' rather than
//     throwing (the tool is read-only diagnostics; failing info-collection
//     defeats the purpose).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { GWS_BIN_ENV } from '../../../src/gws/paths.js';
import { __resetVersionCacheForTests } from '../../../src/gws/runner.js';
import {
  __resetConciergeInfoCachesForTests,
  conciergeInfo,
  ConciergeInfoOutputSchema,
} from '../../../src/tools/management/concierge-info.js';
import type { ToolContext } from '../../../src/tools/types.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_PKG_ROOT = path.resolve(HERE, '..', '..', '..');

let priorBinEnv: string | undefined;
let tmpDir: string;

beforeEach(async () => {
  priorBinEnv = process.env[GWS_BIN_ENV];
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'concierge-info-'));
  __resetVersionCacheForTests();
  __resetConciergeInfoCachesForTests();
});

afterEach(async () => {
  if (priorBinEnv === undefined) delete process.env[GWS_BIN_ENV];
  else process.env[GWS_BIN_ENV] = priorBinEnv;
  __resetVersionCacheForTests();
  __resetConciergeInfoCachesForTests();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('concierge_info tool definition', () => {
  it('is named concierge_info and is readonly', () => {
    expect(conciergeInfo.name).toBe('concierge_info');
    expect(conciergeInfo.service).toBe('management');
    expect(conciergeInfo.readonly).toBe(true);
  });

  it('has an empty strict input schema', () => {
    // An empty object is the only valid input.
    expect(() => conciergeInfo.input.parse({})).not.toThrow();
    expect(() => conciergeInfo.input.parse({ foo: 'bar' })).toThrow();
  });
});

describe('concierge_info invoke (happy path)', () => {
  it('returns a well-formed envelope matching the output schema when gws is resolvable', async () => {
    // Fake gws binary: a tiny shell script that prints a version line.
    const fake = path.join(tmpDir, 'gws');
    await fs.writeFile(
      fake,
      '#!/usr/bin/env bash\nif [ "$1" = "--version" ]; then echo "gws 1.2.3"; exit 0; fi\nexit 0\n',
      { mode: 0o755 },
    );
    process.env[GWS_BIN_ENV] = fake;

    const ctx: ToolContext = { now: '2026-04-14T00:00:00.000Z' };
    const result = await conciergeInfo.invoke({}, ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');

    // Schema guards everything; parsing here asserts shape compliance.
    const parsed = ConciergeInfoOutputSchema.parse(result.data);

    expect(parsed.concierge.vendor_package).toBe('@concierge/google-workspace');
    expect(parsed.concierge.vendor_version).toMatch(/^\d+\.\d+\.\d+/);
    expect(parsed.concierge.core_version).toMatch(/^\d+\.\d+\.\d+/);

    // Build stamp: either the tsup-injected real values (ISO + 8 hex chars)
    // or the dev-fallback sentinels ('dev-unbuilt' / 'devbuild'). Either way
    // the fields must be non-empty strings.
    expect(typeof parsed.concierge.build_time).toBe('string');
    expect(parsed.concierge.build_time.length).toBeGreaterThan(0);
    expect(
      parsed.concierge.build_time === 'dev-unbuilt' ||
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(parsed.concierge.build_time),
    ).toBe(true);
    expect(typeof parsed.concierge.build_id).toBe('string');
    expect(
      parsed.concierge.build_id === 'devbuild' || /^[0-9a-f]{8}$/.test(parsed.concierge.build_id),
    ).toBe(true);

    // Full version line from gws --version — includes the `gws` prefix.
    expect(parsed.gws.version).toBe('gws 1.2.3');
    // 64 lowercase hex chars for a concrete file.
    expect(parsed.gws.binary_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.gws.binary_path).toBe(fake);

    expect(parsed.runtime.node).toBe(process.version);
    expect(parsed.runtime.platform).toBe(process.platform);
    expect(parsed.runtime.arch).toBe(process.arch);

    // Manifest should be readable in dev layout.
    expect(parsed.manifest.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(parsed.manifest.mcp_manifest_version).toMatch(/^\d+\.\d+$/);
  });

  it('vendor_version matches the package.json version on disk', async () => {
    const pkgJsonPath = path.join(REPO_PKG_ROOT, 'package.json');
    const pkgRaw = await fs.readFile(pkgJsonPath, 'utf8');
    const pkg = JSON.parse(pkgRaw) as { version: string };

    const fake = path.join(tmpDir, 'gws');
    await fs.writeFile(
      fake,
      '#!/usr/bin/env bash\nif [ "$1" = "--version" ]; then echo "gws 1.2.3"; exit 0; fi\nexit 0\n',
      { mode: 0o755 },
    );
    process.env[GWS_BIN_ENV] = fake;

    const result = await conciergeInfo.invoke({}, { now: '2026-04-14T00:00:00.000Z' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.concierge.vendor_version).toBe(pkg.version);
  });

  it('core_version matches the @concierge/core package.json on disk', async () => {
    const coreJsonPath = path.resolve(REPO_PKG_ROOT, '..', 'core', 'package.json');
    const raw = await fs.readFile(coreJsonPath, 'utf8');
    const core = JSON.parse(raw) as { version: string };

    const fake = path.join(tmpDir, 'gws');
    await fs.writeFile(
      fake,
      '#!/usr/bin/env bash\nif [ "$1" = "--version" ]; then echo "gws 1.2.3"; exit 0; fi\nexit 0\n',
      { mode: 0o755 },
    );
    process.env[GWS_BIN_ENV] = fake;

    const result = await conciergeInfo.invoke({}, { now: '2026-04-14T00:00:00.000Z' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.concierge.core_version).toBe(core.version);
  });
});

describe('concierge_info invoke (degraded paths)', () => {
  it('returns unknown gws version + unknown binary_path when CONCIERGE_GWS_BIN points at a missing file', async () => {
    // Set the env var to a non-existent path. The env-var precedence branch
    // throws inside resolveGwsBinary; the tool catches, surfaces "unknown".
    process.env[GWS_BIN_ENV] = path.join(tmpDir, 'does-not-exist');

    const result = await conciergeInfo.invoke({}, { now: '2026-04-14T00:00:00.000Z' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.gws.version).toBe('unknown');
    expect(result.data.gws.binary_sha256).toBe('unknown');
    expect(result.data.gws.binary_path).toBe('unknown');

    // Even degraded, everything else still populates.
    expect(result.data.concierge.vendor_package).toBe('@concierge/google-workspace');
    expect(result.data.runtime.node).toBe(process.version);
  });
});
