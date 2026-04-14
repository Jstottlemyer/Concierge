// Manifest test — validates `manifest.json` at the repo root.
//
// `manifest.json` drives the Claude Desktop `.mcpb` package (T18). The MCPB
// runtime parses it at install-time; malformed or missing fields mean the
// extension fails silently or refuses to load. This test guards the minimum
// schema invariants:
//   - MCPB v0.3 required fields are present
//   - server.type is `node` (spike T0.1 confirmed this path works; Desktop
//     provisions the runtime so we don't bundle Node ourselves)
//   - platforms is macOS-only for v1 (constitution)
//   - version stays in lockstep with package.json
//
// Spec ref: docs/vendors/google-workspace/spec.md Integration § Manifest,
// plan.md T18.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, it, expect } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const MANIFEST_PATH = join(REPO_ROOT, 'manifest.json');
const PACKAGE_PATH = join(REPO_ROOT, 'package.json');

interface ManifestShape {
  manifest_version: string;
  name: string;
  display_name: string;
  version: string;
  description: string;
  long_description?: string;
  author: { name: string };
  homepage?: string;
  server: {
    type: string;
    entry_point: string;
    mcp_config: {
      command: string;
      args: string[];
    };
  };
  tools_generated?: boolean;
  compatibility: {
    claude_desktop?: string;
    platforms: string[];
    runtimes?: { node?: string };
  };
  user_config: Record<string, unknown>;
  keywords?: string[];
  license?: string;
}

function loadManifest(): ManifestShape {
  const raw = readFileSync(MANIFEST_PATH, 'utf8');
  return JSON.parse(raw) as ManifestShape;
}

function loadPackageVersion(): string {
  const raw = readFileSync(PACKAGE_PATH, 'utf8');
  const parsed = JSON.parse(raw) as { version: string };
  return parsed.version;
}

describe('manifest.json', () => {
  it('parses as valid JSON', () => {
    expect(() => loadManifest()).not.toThrow();
  });

  it('declares MCPB v0.3 manifest_version', () => {
    const m = loadManifest();
    expect(m.manifest_version).toBe('0.3');
  });

  it('has required top-level identity fields', () => {
    const m = loadManifest();
    expect(m.name).toBeTruthy();
    expect(m.display_name).toBeTruthy();
    expect(m.version).toBeTruthy();
    expect(m.description).toBeTruthy();
    expect(m.author?.name).toBeTruthy();
  });

  it('keeps version in lockstep with package.json', () => {
    const m = loadManifest();
    expect(m.version).toBe(loadPackageVersion());
  });

  it('declares server.type === "node" (Desktop provisions runtime)', () => {
    const m = loadManifest();
    expect(m.server.type).toBe('node');
    expect(m.server.entry_point).toBe('dist/index.js');
    expect(m.server.mcp_config.command).toBe('node');
    expect(m.server.mcp_config.args).toContain('${__dirname}/dist/index.js');
  });

  it('targets macOS only (platforms includes darwin, nothing else in v1)', () => {
    const m = loadManifest();
    expect(m.compatibility.platforms).toContain('darwin');
    // v1 is darwin-only per constitution; guard against accidental additions.
    expect(m.compatibility.platforms).toEqual(['darwin']);
  });

  it('requires Node >= 18 at runtime', () => {
    const m = loadManifest();
    expect(m.compatibility.runtimes?.node).toBeTruthy();
    expect(m.compatibility.runtimes?.node).toMatch(/>=18/);
  });

  it('marks tools as generated (dynamic 40-tool registration)', () => {
    const m = loadManifest();
    expect(m.tools_generated).toBe(true);
  });

  it('ships with zero required user_config (v1)', () => {
    const m = loadManifest();
    expect(m.user_config).toEqual({});
  });
});
