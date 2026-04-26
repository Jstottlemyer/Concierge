// B6 tests: real-fs exercise of the read-only I/O boundary.
//
// We use real fs (not memfs) because the Claude Desktop extension path
// includes a literal " " (space) in "Application Support" / "Claude
// Extensions", and the helper's contract is that `path.join` propagates
// that verbatim. Real fs gives us the highest-fidelity assertion that the
// path string matches what Claude Desktop and the C7 recovery rm -rf will
// see.
//
// Synthetic homedir is `os.tmpdir()/concierge-readonly-<rand>`; tests
// clean up after themselves.

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  readClaudeJson,
  readGwsClientSecret,
  statClaudeExtensionDir,
} from '../../src/io/readonly.js';

const NAMESPACE = 'local.mcpb.justin-stottlemyer.concierge-google-workspace';

let HOME: string;

beforeEach(async () => {
  HOME = await mkdtemp(join(tmpdir(), 'concierge-readonly-'));
});

afterEach(async () => {
  await rm(HOME, { recursive: true, force: true });
});

describe('readGwsClientSecret', () => {
  it('returns file contents when ~/.config/gws/client_secret.json exists', async () => {
    const dir = join(HOME, '.config', 'gws');
    await mkdir(dir, { recursive: true });
    const payload = JSON.stringify({
      installed: {
        client_id: '123-abc.apps.googleusercontent.com',
        project_id: 'desktop-app-493302',
      },
    });
    await writeFile(join(dir, 'client_secret.json'), payload, 'utf8');

    const result = await readGwsClientSecret(HOME);
    expect(result).toBe(payload);
  });

  it('returns null when ~/.config/gws/client_secret.json is absent', async () => {
    const result = await readGwsClientSecret(HOME);
    expect(result).toBeNull();
  });

  it('returns null when the parent directories do not exist either', async () => {
    // No ~/.config dir at all — still ENOENT, still null.
    const result = await readGwsClientSecret(HOME);
    expect(result).toBeNull();
  });
});

describe('readClaudeJson', () => {
  it('returns file contents when ~/.claude.json exists', async () => {
    const payload = JSON.stringify({
      mcpServers: {
        concierge: {
          type: 'stdio',
          command: 'node',
          args: ['/some/path/dist/index.js'],
        },
      },
    });
    await writeFile(join(HOME, '.claude.json'), payload, 'utf8');

    const result = await readClaudeJson(HOME);
    expect(result).toBe(payload);
  });

  it('returns null when ~/.claude.json is absent', async () => {
    const result = await readClaudeJson(HOME);
    expect(result).toBeNull();
  });
});

describe('statClaudeExtensionDir', () => {
  it('returns { exists: true, absPath } when the unpacked extension dir is present', async () => {
    const extDir = join(
      HOME,
      'Library',
      'Application Support',
      'Claude',
      'Claude Extensions',
      NAMESPACE,
    );
    await mkdir(extDir, { recursive: true });

    const result = await statClaudeExtensionDir(HOME, NAMESPACE);
    expect(result.exists).toBe(true);
    expect(result.absPath).toBe(extDir);
  });

  it('returns { exists: false, absPath } when the unpacked extension dir is absent', async () => {
    const result = await statClaudeExtensionDir(HOME, NAMESPACE);
    expect(result.exists).toBe(false);
    // absPath is still the canonical computed path even when the dir is missing.
    expect(result.absPath).toBe(
      join(
        HOME,
        'Library',
        'Application Support',
        'Claude',
        'Claude Extensions',
        NAMESPACE,
      ),
    );
  });

  it('preserves the namespace verbatim in the computed absPath (no escaping of spaces or dots)', async () => {
    const result = await statClaudeExtensionDir(HOME, NAMESPACE);
    // The literal namespace string must appear as-is in the path (path.join
    // does not URL-encode or shell-quote). The "Application Support" + "Claude
    // Extensions" segments must each contain a real space.
    expect(result.absPath).toContain(NAMESPACE);
    expect(result.absPath).toContain(' Application Support'.trimStart()); // explicit space token
    expect(result.absPath).toContain('Application Support');
    expect(result.absPath).toContain('Claude Extensions');
    expect(result.absPath.endsWith(`/${NAMESPACE}`)).toBe(true);
  });

  it('handles a namespace with the v0.1.0 author/name shape unchanged', async () => {
    const altNamespace = 'local.mcpb.someone-else.another-vendor';
    const result = await statClaudeExtensionDir(HOME, altNamespace);
    expect(result.exists).toBe(false);
    expect(result.absPath).toContain(altNamespace);
    expect(result.absPath.endsWith(`/${altNamespace}`)).toBe(true);
  });
});
