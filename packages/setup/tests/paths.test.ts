// D5 tests: paths.ts resolution helpers.
//
// In vitest, `import.meta.url` inside `paths.ts` points at
// `packages/setup/src/paths.ts`. So:
//   - resolveUnpackedDistIndexJsPath() returns the absolute path to that file.
//   - resolveAssetsDir() returns the sibling `assets/` of `src/` (i.e.
//     `packages/setup/assets/`), which is exactly where the build assets live
//     in the package layout.
//
// The production layout (`dist/index.js` + sibling `assets/`) follows the
// same `..` walk, so this test exercises the exact resolution rule.

import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  resolveAssetsDir,
  resolveUnpackedDistIndexJsPath,
} from '../src/paths.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(HERE, '..', 'src');
const PACKAGE_DIR = resolve(HERE, '..');

describe('resolveUnpackedDistIndexJsPath', () => {
  it('returns the absolute filesystem path of paths.ts under vitest', () => {
    const got = resolveUnpackedDistIndexJsPath();
    expect(got).toBe(resolve(SRC_DIR, 'paths.ts'));
  });

  it('returns an absolute path that exists on disk', () => {
    const got = resolveUnpackedDistIndexJsPath();
    expect(got.startsWith('/')).toBe(true);
    expect(existsSync(got)).toBe(true);
  });
});

describe('resolveAssetsDir', () => {
  it('returns the sibling assets/ of the running file (one level up)', () => {
    const got = resolveAssetsDir();
    expect(got).toBe(resolve(PACKAGE_DIR, 'assets'));
  });

  it('points at a directory that exists in the package layout', () => {
    const got = resolveAssetsDir();
    // The package ships an `assets/` dir; verify the resolution targets it.
    expect(existsSync(got)).toBe(true);
    expect(statSync(got).isDirectory()).toBe(true);
  });
});
