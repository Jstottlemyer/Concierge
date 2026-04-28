// D5: Path resolvers used by the `concierge-setup` entry point.
//
// The bash bootstrap (E1) extracts the published tarball into a `mktemp -d`
// like `/tmp/concierge-setup.XXX/` whose layout is:
//
//   /tmp/concierge-setup.XXX/
//   ├── dist/index.js          ← THIS file at runtime
//   ├── assets/
//   │   ├── manifest.json
//   │   └── Concierge-GoogleWorkspace-<v>-darwin-arm64.mcpb
//   └── package.json
//
// So when the bundle runs from `dist/index.js`:
//   - `assetsDir`              = sibling `assets/` (i.e. `dist/../assets/`)
//   - `unpackedDistIndexJsPath` = filesystem path of the running file itself
//
// We isolate the resolution here so the entry point stays trivial and the
// resolution logic is independently testable. Per CLAUDE.md, tsup may flatten
// `dist/` to a single file in production, so the relative `..` from `dist/`
// to `assets/` is the assumed layout. If a future build layout breaks this,
// add multi-candidate resolution here without touching `index.ts`.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/** Absolute filesystem path of the running `dist/index.js` (or the test file
 *  importing this module — in vitest, `import.meta.url` points at `src/...`). */
export function resolveUnpackedDistIndexJsPath(): string {
  return fileURLToPath(import.meta.url);
}

/** Absolute path to the sibling `assets/` directory of `dist/index.js`. */
export function resolveAssetsDir(): string {
  const distDir = dirname(fileURLToPath(import.meta.url));
  return resolve(distDir, '..', 'assets');
}
