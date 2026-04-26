// B2 tests: validate readEmbeddedManifest's behavior on every documented
// failure mode plus the happy path. Uses the G0 memfs helper so we don't
// have to scribble files onto the real disk.
//
// Each test installs the mock, dynamically imports the SUT, exercises it,
// then uninstalls. Dynamic import is required so the vi.doMock substitution
// applies to the SUT's `node:fs/promises` import.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createMemFs } from '../helpers/memfs.js';

import type { EmbeddedManifest } from '../../src/types/manifest.js';

const MANIFEST_PATH = '/assets/manifest.json';

const validManifest: EmbeddedManifest = {
  schemaVersion: 1,
  bundledMcpb: {
    filename: 'Concierge-GoogleWorkspace-0.2.0-darwin-arm64.mcpb',
    version: '0.2.0',
    sha256: 'a'.repeat(64),
    arch: 'darwin-arm64',
    namespace: 'local.mcpb.justin-stottlemyer.concierge-google-workspace',
    buildId: 'build-12345',
    buildTime: '2026-04-16T12:00:00Z',
    sourceCommit: 'b'.repeat(40),
  },
  setupVersion: '2.0.0',
};

const memfs = createMemFs();

beforeEach(() => {
  memfs.reset();
  memfs.install();
});

afterEach(() => {
  memfs.uninstall();
});

async function loadSut(): Promise<
  typeof import('../../src/state/manifest.js')
> {
  return import('../../src/state/manifest.js');
}

function preloadManifest(obj: unknown): void {
  memfs.preload({ [MANIFEST_PATH]: JSON.stringify(obj) });
}

describe('readEmbeddedManifest', () => {
  it('returns the parsed object for a valid manifest', async () => {
    preloadManifest(validManifest);
    const { readEmbeddedManifest } = await loadSut();
    const result = await readEmbeddedManifest(MANIFEST_PATH);
    expect(result).toEqual(validManifest);
  });

  it('throws a file-not-found error when the manifest is missing', async () => {
    const { readEmbeddedManifest } = await loadSut();
    await expect(readEmbeddedManifest(MANIFEST_PATH)).rejects.toThrow(
      /not found.*file-not-found/,
    );
  });

  it('throws a parse-error when the file is malformed JSON', async () => {
    memfs.preload({ [MANIFEST_PATH]: '{ not valid json' });
    const { readEmbeddedManifest } = await loadSut();
    await expect(readEmbeddedManifest(MANIFEST_PATH)).rejects.toThrow(
      /parse-error/,
    );
  });

  it('throws when schemaVersion is anything other than the literal 1', async () => {
    preloadManifest({ ...validManifest, schemaVersion: 2 });
    const { readEmbeddedManifest } = await loadSut();
    await expect(readEmbeddedManifest(MANIFEST_PATH)).rejects.toThrow(
      /"schemaVersion".*literal 1/,
    );
  });

  it('throws naming the missing field when sha256 is omitted', async () => {
    const { bundledMcpb, ...rest } = validManifest;
    const { sha256: _omitted, ...mcpbNoSha } = bundledMcpb;
    void _omitted;
    preloadManifest({ ...rest, bundledMcpb: mcpbNoSha });
    const { readEmbeddedManifest } = await loadSut();
    await expect(readEmbeddedManifest(MANIFEST_PATH)).rejects.toThrow(
      /missing required field "bundledMcpb.sha256"/,
    );
  });

  it('throws when sha256 is too short / non-hex', async () => {
    preloadManifest({
      ...validManifest,
      bundledMcpb: { ...validManifest.bundledMcpb, sha256: 'deadbeef' },
    });
    const { readEmbeddedManifest } = await loadSut();
    await expect(readEmbeddedManifest(MANIFEST_PATH)).rejects.toThrow(
      /"bundledMcpb.sha256".*64 lowercase hex/,
    );

    // Uppercase hex also fails (must be lowercase).
    memfs.reset();
    preloadManifest({
      ...validManifest,
      bundledMcpb: { ...validManifest.bundledMcpb, sha256: 'A'.repeat(64) },
    });
    await expect(readEmbeddedManifest(MANIFEST_PATH)).rejects.toThrow(
      /"bundledMcpb.sha256"/,
    );
  });

  it('throws when namespace shape is wrong', async () => {
    preloadManifest({
      ...validManifest,
      bundledMcpb: {
        ...validManifest.bundledMcpb,
        namespace: 'com.example.bad',
      },
    });
    const { readEmbeddedManifest } = await loadSut();
    await expect(readEmbeddedManifest(MANIFEST_PATH)).rejects.toThrow(
      /"bundledMcpb.namespace"/,
    );
  });

  it('throws when arch is not one of the allowed darwin values', async () => {
    preloadManifest({
      ...validManifest,
      bundledMcpb: {
        ...validManifest.bundledMcpb,
        arch: 'linux-x64',
      },
    });
    const { readEmbeddedManifest } = await loadSut();
    await expect(readEmbeddedManifest(MANIFEST_PATH)).rejects.toThrow(
      /"bundledMcpb.arch".*darwin-arm64.*darwin-x64/,
    );
  });

  it('accepts darwin-x64 as a valid arch (sibling of arm64)', async () => {
    preloadManifest({
      ...validManifest,
      bundledMcpb: { ...validManifest.bundledMcpb, arch: 'darwin-x64' },
    });
    const { readEmbeddedManifest } = await loadSut();
    const result = await readEmbeddedManifest(MANIFEST_PATH);
    expect(result.bundledMcpb.arch).toBe('darwin-x64');
  });

  it('throws when buildTime does not parse as a valid Date', async () => {
    preloadManifest({
      ...validManifest,
      bundledMcpb: {
        ...validManifest.bundledMcpb,
        buildTime: 'not-a-date',
      },
    });
    const { readEmbeddedManifest } = await loadSut();
    await expect(readEmbeddedManifest(MANIFEST_PATH)).rejects.toThrow(
      /"bundledMcpb.buildTime".*valid Date/,
    );
  });

  it('throws when sourceCommit is not a 40-char hex sha', async () => {
    preloadManifest({
      ...validManifest,
      bundledMcpb: {
        ...validManifest.bundledMcpb,
        sourceCommit: 'abc123',
      },
    });
    const { readEmbeddedManifest } = await loadSut();
    await expect(readEmbeddedManifest(MANIFEST_PATH)).rejects.toThrow(
      /"bundledMcpb.sourceCommit".*40-char/,
    );
  });

  it('throws when top-level JSON is an array, not an object', async () => {
    memfs.preload({ [MANIFEST_PATH]: '[1,2,3]' });
    const { readEmbeddedManifest } = await loadSut();
    await expect(readEmbeddedManifest(MANIFEST_PATH)).rejects.toThrow(
      /top-level must be a JSON object/,
    );
  });

  it('throws when setupVersion is missing or empty', async () => {
    const { setupVersion: _drop, ...withoutSetupVersion } = validManifest;
    void _drop;
    preloadManifest(withoutSetupVersion);
    const { readEmbeddedManifest } = await loadSut();
    await expect(readEmbeddedManifest(MANIFEST_PATH)).rejects.toThrow(
      /missing required field "root.setupVersion"/,
    );

    memfs.reset();
    preloadManifest({ ...validManifest, setupVersion: '' });
    await expect(readEmbeddedManifest(MANIFEST_PATH)).rejects.toThrow(
      /"setupVersion".*non-empty string/,
    );
  });
});
