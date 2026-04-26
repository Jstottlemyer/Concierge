// D4: Tests for the external-probe extension seam (hooks.ts).
//
// Each test starts with `__resetProbesForTests()` so module-scope registry
// state never leaks between cases. Filesystem fixtures are written under
// `os.tmpdir()` per-test for the discovery cases.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetProbesForTests,
  discoverExternalProbes,
  getRegisteredProbes,
  registerProbe,
  type ExternalProbe,
} from '../src/hooks.js';
import type { ProbeResult } from '../src/types/probe.js';

function makeProbe(
  overrides: Partial<ExternalProbe> = {},
): ExternalProbe {
  return {
    name: overrides.name ?? 'auth.probe',
    source: overrides.source ?? '@concierge/auth-probe',
    run:
      overrides.run ??
      (async (): Promise<ProbeResult<unknown>> => ({
        name: 'gws.authStatus',
        status: 'ok',
        durationMs: 1,
        timestamp: new Date(0).toISOString(),
      })),
  };
}

let scratch: string;

beforeEach(async () => {
  __resetProbesForTests();
  scratch = await mkdtemp(join(tmpdir(), 'concierge-hooks-test-'));
});

afterEach(async () => {
  __resetProbesForTests();
  await rm(scratch, { recursive: true, force: true });
});

describe('registerProbe + getRegisteredProbes', () => {
  it('round-trips a single registration', () => {
    const probe = makeProbe();
    registerProbe(probe);
    const all = getRegisteredProbes();
    expect(all).toHaveLength(1);
    expect(all[0]).toBe(probe);
  });

  it('returns all registered probes when multiple are added', () => {
    const a = makeProbe({ name: 'auth.token', source: '@concierge/auth-probe' });
    const b = makeProbe({ name: 'audit.log', source: '@concierge/audit-log' });
    const c = makeProbe({ name: 'auth.scopes', source: '@concierge/auth-probe' });
    registerProbe(a);
    registerProbe(b);
    registerProbe(c);
    const names = getRegisteredProbes()
      .map((p) => p.name)
      .sort();
    expect(names).toEqual(['audit.log', 'auth.scopes', 'auth.token']);
  });

  it('last-write-wins on duplicate name and warns', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const first = makeProbe({ name: 'auth.x', source: '@concierge/auth-probe' });
      const second = makeProbe({
        name: 'auth.x',
        source: '@concierge/auth-probe-replacement',
      });
      registerProbe(first);
      registerProbe(second);

      const all = getRegisteredProbes();
      expect(all).toHaveLength(1);
      expect(all[0]).toBe(second);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [msg] = warnSpy.mock.calls[0] as [string];
      expect(msg).toContain('auth.x');
      expect(msg).toContain('last-write-wins');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('__resetProbesForTests clears the registry', () => {
    registerProbe(makeProbe({ name: 'one' }));
    registerProbe(makeProbe({ name: 'two' }));
    expect(getRegisteredProbes()).toHaveLength(2);
    __resetProbesForTests();
    expect(getRegisteredProbes()).toHaveLength(0);
  });
});

describe('discoverExternalProbes', () => {
  it('returns a clean no-op when searchRoot does not exist', async () => {
    const result = await discoverExternalProbes({
      searchRoot: join(scratch, 'does-not-exist'),
    });
    expect(result).toEqual({ discovered: 0, errors: [] });
    expect(getRegisteredProbes()).toHaveLength(0);
  });

  it('returns a clean no-op when scope dir is empty', async () => {
    await mkdir(join(scratch, '@concierge'), { recursive: true });
    const result = await discoverExternalProbes({ searchRoot: scratch });
    expect(result).toEqual({ discovered: 0, errors: [] });
    expect(getRegisteredProbes()).toHaveLength(0);
  });

  it('skips packages whose name does not match @concierge/*-probe', async () => {
    const pkgRoot = join(scratch, '@concierge', 'core');
    await mkdir(pkgRoot, { recursive: true });
    await writeFile(
      join(pkgRoot, 'package.json'),
      JSON.stringify({ name: '@concierge/core', main: 'index.js' }),
    );
    await writeFile(
      join(pkgRoot, 'index.js'),
      'throw new Error("should not be imported");',
    );

    const result = await discoverExternalProbes({ searchRoot: scratch });
    expect(result).toEqual({ discovered: 0, errors: [] });
    expect(getRegisteredProbes()).toHaveLength(0);
  });

  it('imports a fixture @concierge/test-probe package and registers its probe', async () => {
    const pkgRoot = join(scratch, '@concierge', 'test-probe');
    await mkdir(pkgRoot, { recursive: true });
    await writeFile(
      join(pkgRoot, 'package.json'),
      JSON.stringify({
        name: '@concierge/test-probe',
        type: 'module',
        main: 'index.mjs',
      }),
    );
    // The fixture imports the live hooks module via absolute file URL so the
    // registry mutation lands in the same module instance vitest sees.
    const hooksModUrl = new URL('../src/hooks.ts', import.meta.url).href;
    await writeFile(
      join(pkgRoot, 'index.mjs'),
      `import { registerProbe } from ${JSON.stringify(hooksModUrl)};
registerProbe({
  name: 'test.probe',
  source: '@concierge/test-probe',
  run: async () => ({
    name: 'gws.authStatus',
    status: 'ok',
    durationMs: 0,
    timestamp: new Date(0).toISOString(),
  }),
});
`,
    );

    const result = await discoverExternalProbes({ searchRoot: scratch });
    expect(result.errors).toEqual([]);
    expect(result.discovered).toBe(1);
    const all = getRegisteredProbes();
    expect(all).toHaveLength(1);
    expect(all[0]?.name).toBe('test.probe');
    expect(all[0]?.source).toBe('@concierge/test-probe');
  });

  it('records per-package import errors without throwing', async () => {
    const pkgRoot = join(scratch, '@concierge', 'broken-probe');
    await mkdir(pkgRoot, { recursive: true });
    await writeFile(
      join(pkgRoot, 'package.json'),
      JSON.stringify({
        name: '@concierge/broken-probe',
        type: 'module',
        main: 'index.mjs',
      }),
    );
    await writeFile(
      join(pkgRoot, 'index.mjs'),
      'throw new Error("boom from broken-probe");',
    );

    const result = await discoverExternalProbes({ searchRoot: scratch });
    expect(result.discovered).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.pkg).toBe('@concierge/broken-probe');
    expect(result.errors[0]?.err).toContain('boom from broken-probe');
    expect(getRegisteredProbes()).toHaveLength(0);
  });
});
