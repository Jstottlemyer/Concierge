import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const pkgJson = JSON.parse(
  readFileSync(join(HERE, 'package.json'), 'utf8'),
) as { version: string };
const vendorVersion = pkgJson.version;

// Read sibling @concierge/core version — the core package ships its own
// semver independent of the vendor. If the file is missing (e.g. before the
// workspace is fully bootstrapped), fall back to '0.0.0-unknown' so tsup can
// still run; production builds will always have the sibling present.
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

// Build-stamp identifiers — baked into the bundle so a running server can
// tell which build artifact it is. `buildTime` is the ISO-8601 timestamp of
// this config evaluation; `buildId` is a short 8-char hex distinguisher
// derived from the timestamp + both versions. Every `tsup` run gets a fresh
// pair, so installers can quickly tell stale bundles from fresh ones.
const buildTime = new Date().toISOString();
const buildId = createHash('sha256')
  .update(buildTime + vendorVersion + coreVersion)
  .digest('hex')
  .slice(0, 8);

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  outDir: 'dist',
  platform: 'node',
  target: 'node18',
  // Bundle all runtime deps so the .mcpb ships without node_modules.
  // `@concierge/core` is a workspace dep that gets inlined here — on publish
  // it is not a separate runtime dependency.
  noExternal: [
    '@concierge/core',
    '@modelcontextprotocol/sdk',
    'zod',
    'zod-to-json-schema',
    'ajv',
    'ajv-formats',
  ],
  // Skip optional transitive deps that aren't actually loaded at runtime
  external: ['node:*'],
  define: {
    __CONCIERGE_VENDOR_VERSION__: JSON.stringify(vendorVersion),
    __CONCIERGE_CORE_VERSION__: JSON.stringify(coreVersion),
    __CONCIERGE_BUILD_TIME__: JSON.stringify(buildTime),
    __CONCIERGE_BUILD_ID__: JSON.stringify(buildId),
  },
});
