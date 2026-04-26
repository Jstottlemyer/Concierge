import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const pkgJson = JSON.parse(
  readFileSync(join(HERE, 'package.json'), 'utf8'),
) as { version: string };
const setupVersion = pkgJson.version;

// Read sibling @concierge/core version — independent semver from the setup
// CLI. Falls back to a placeholder if the workspace isn't fully bootstrapped
// yet (e.g. during the first scaffold), so tsup can still run.
function readCoreVersion(): string {
  try {
    const raw = readFileSync(join(HERE, '..', 'core', 'package.json'), 'utf8');
    const parsed = JSON.parse(raw) as { version: string };
    return parsed.version;
  } catch {
    return '0.0.0-unknown';
  }
}
const coreVersion = readCoreVersion();

// Build-stamp identifiers — baked into the bundle so the running CLI can
// report which build it is (helps diagnose stale installs the same way the
// vendor packages do via concierge_info).
const buildTime = new Date().toISOString();
const buildId = createHash('sha256')
  .update(buildTime + setupVersion + coreVersion)
  .digest('hex')
  .slice(0, 8);

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  outDir: 'dist',
  platform: 'node',
  target: 'node20',
  // Bundle every runtime dep so the published CLI ships as a single file.
  noExternal: [/.*/],
  external: ['node:*'],
  define: {
    __CONCIERGE_SETUP_VERSION__: JSON.stringify(setupVersion),
    __CONCIERGE_CORE_VERSION__: JSON.stringify(coreVersion),
    __CONCIERGE_BUILD_TIME__: JSON.stringify(buildTime),
    __CONCIERGE_BUILD_ID__: JSON.stringify(buildId),
  },
});
