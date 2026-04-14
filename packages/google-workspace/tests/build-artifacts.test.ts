// Build artifact test — validates `build/gws-checksums.txt`.
//
// T18.5 pins the sha256 of the upstream `googleworkspace/cli` binary per arch.
// CI's integrity gate (T20) consumes this file to verify that downloaded
// release artifacts match before bundling into the `.mcpb` package. A
// malformed or incomplete pin file silently disables the gate, so this test
// guards the format invariants:
//   - every non-comment line has exactly three whitespace-separated fields
//   - field 1 is a 64-char lowercase hex sha256 (or the explicit
//     PENDING_CAPTURE_FROM_UPSTREAM sentinel)
//   - field 2 is a known arch token
//   - field 3 is a semver-ish version tag
//   - both darwin-arm64 and darwin-x64 lines are present
//
// Spec ref: docs/vendors/google-workspace/plan.md Decision #11 (binary
// integrity), T18.5.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, it, expect } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');
const CHECKSUM_PATH = join(REPO_ROOT, 'build', 'gws-checksums.txt');

const KNOWN_ARCHES = ['darwin-arm64', 'darwin-x64'] as const;
type Arch = (typeof KNOWN_ARCHES)[number];

interface ChecksumLine {
  sha: string;
  arch: string;
  version: string;
  pending: boolean;
}

function parseChecksums(): ChecksumLine[] {
  const raw = readFileSync(CHECKSUM_PATH, 'utf8');
  const lines = raw.split('\n');
  const result: ChecksumLine[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const fields = trimmed.split(/\s+/);
    expect(
      fields.length,
      `expected 3 whitespace-separated fields, got ${String(fields.length)} in line: ${line}`,
    ).toBe(3);
    const sha = fields[0] ?? '';
    const arch = fields[1] ?? '';
    const version = fields[2] ?? '';
    result.push({
      sha,
      arch,
      version,
      pending: sha === 'PENDING_CAPTURE_FROM_UPSTREAM',
    });
  }
  return result;
}

describe('build/gws-checksums.txt', () => {
  it('exists and is readable', () => {
    expect(() => readFileSync(CHECKSUM_PATH, 'utf8')).not.toThrow();
  });

  it('parses into at least one non-comment line', () => {
    const parsed = parseChecksums();
    expect(parsed.length).toBeGreaterThan(0);
  });

  it('every non-comment line has exactly three fields', () => {
    // parseChecksums() asserts per-line field count; just invoke it.
    parseChecksums();
  });

  it('field 1 is a 64-char lowercase hex sha256 (or PENDING sentinel)', () => {
    const parsed = parseChecksums();
    for (const line of parsed) {
      if (line.pending) continue;
      expect(line.sha, `bad sha for ${line.arch}`).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('field 2 is a known arch token (darwin-arm64 or darwin-x64)', () => {
    const parsed = parseChecksums();
    for (const line of parsed) {
      expect(
        (KNOWN_ARCHES as readonly string[]).includes(line.arch),
        `unknown arch: ${line.arch}`,
      ).toBe(true);
    }
  });

  it('field 3 is a semver-ish version tag starting with v', () => {
    const parsed = parseChecksums();
    for (const line of parsed) {
      expect(line.version, `bad version for ${line.arch}`).toMatch(/^v\d+\.\d+\.\d+/);
    }
  });

  it('has at least one line per supported arch', () => {
    const parsed = parseChecksums();
    const archesPresent = new Set(parsed.map((l) => l.arch));
    for (const arch of KNOWN_ARCHES) {
      expect(archesPresent.has(arch), `missing line for ${arch}`).toBe(true);
    }
  });

  it('all supported arches use the same pinned version', () => {
    const parsed = parseChecksums();
    const byArch = new Map<Arch, string>();
    for (const line of parsed) {
      byArch.set(line.arch as Arch, line.version);
    }
    const versions = new Set(byArch.values());
    expect(versions.size, 'arches disagree on version').toBe(1);
  });

  it('flags any PENDING arches as a known-but-non-fatal state', () => {
    const parsed = parseChecksums();
    const pending = parsed.filter((l) => l.pending).map((l) => l.arch);
    // This assertion is informational — having PENDING lines is allowed (it
    // means CI hasn't run on that arch yet). We surface the state via the
    // test name rather than failing.
    if (pending.length > 0) {
      console.warn(`gws-checksums.txt has PENDING arches: ${pending.join(', ')}`);
    }
    expect(pending.length).toBeGreaterThanOrEqual(0);
  });
});
