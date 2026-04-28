// D5 tests: index.ts entry-point wiring.
//
// `main` is exported and only auto-invoked under the `isMainModule()` guard,
// so importing this module in tests is a no-op. We drive `main()` with
// stubbed argv + buffered streams and assert exit codes + captured output.
//
// We do NOT exercise the full orchestrator path here — D1's tests cover
// that. We only assert that `main()`:
//   1. Exists and is async.
//   2. Routes --version and --help to stdout with exit 0.
//   3. Routes unknown flags to stderr with exit 2.
//   4. Routes --diagnose to stdout with exit 0 (text mode renders inline).
//
// For the diagnose path we use a sacrificial `homedir` (a tempdir) so the
// phase doesn't touch the real user's `~/.config/concierge/setup-logs/` etc.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { main } from '../src/index.js';

interface BufferedStream extends Writable {
  buffered(): string;
}

function bufferStream(): BufferedStream {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _enc, cb): void {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      cb();
    },
  }) as BufferedStream;
  stream.buffered = (): string => Buffer.concat(chunks).toString('utf8');
  return stream;
}

let scratchHome: string;

beforeEach(async () => {
  scratchHome = await mkdtemp(join(tmpdir(), 'concierge-setup-index-'));
});

afterEach(async () => {
  await rm(scratchHome, { recursive: true, force: true });
});

describe('main()', () => {
  it('is an async function', () => {
    expect(typeof main).toBe('function');
    // Async functions report as 'AsyncFunction' under Function constructor name.
    expect(main.constructor.name).toBe('AsyncFunction');
  });

  it('handles --version: writes "concierge-setup v..." to stdout, exits 0', async () => {
    const stdout = bufferStream();
    const stderr = bufferStream();
    const r = await main({
      argv: ['--version'],
      stdout,
      stderr,
      homedir: scratchHome,
      env: {},
      isTTY: false,
    });
    expect(r.exitCode).toBe(0);
    expect(stdout.buffered()).toMatch(/^concierge-setup v/);
    expect(stderr.buffered()).toBe('');
  });

  it('handles --help: writes the usage text to stdout, exits 0', async () => {
    const stdout = bufferStream();
    const stderr = bufferStream();
    const r = await main({
      argv: ['--help'],
      stdout,
      stderr,
      homedir: scratchHome,
      env: {},
      isTTY: false,
    });
    expect(r.exitCode).toBe(0);
    const out = stdout.buffered();
    expect(out).toContain('concierge-setup');
    expect(out).toContain('Usage:');
    expect(out).toContain('--diagnose');
    expect(stderr.buffered()).toBe('');
  });

  it('handles an unknown flag: error to stderr, exits 2', async () => {
    const stdout = bufferStream();
    const stderr = bufferStream();
    const r = await main({
      argv: ['--reauth'],
      stdout,
      stderr,
      homedir: scratchHome,
      env: {},
      isTTY: false,
    });
    expect(r.exitCode).toBe(2);
    expect(stdout.buffered()).toBe('');
    expect(stderr.buffered()).toContain("unknown flag '--reauth'");
  });

  it('handles --diagnose: writes the rendered report to stdout, exits 0', async () => {
    const stdout = bufferStream();
    const stderr = bufferStream();
    // Point every probed binary at /usr/bin/false so the phase reports
    // [not installed] for each tool deterministically — no real network or
    // subprocess output reaches the captured stdout.
    const r = await main({
      argv: ['--diagnose'],
      stdout,
      stderr,
      homedir: scratchHome,
      env: {
        CONCIERGE_TEST_BREW_BIN: '/var/empty/no-such-bin',
        CONCIERGE_TEST_NODE_BIN: '/var/empty/no-such-bin',
        CONCIERGE_TEST_GWS_BIN: '/var/empty/no-such-bin',
        CONCIERGE_TEST_GCLOUD_BIN: '/var/empty/no-such-bin',
        CONCIERGE_TEST_CLAUDE_BIN: '/var/empty/no-such-bin',
      },
      isTTY: false,
    });
    expect(r.exitCode).toBe(0);
    const out = stdout.buffered();
    // Diagnose renders sectioned markdown; assert top-level headings appear.
    expect(out).toContain('## Concierge');
    expect(out).toContain('## Versions');
    expect(out).toContain('## Last Setup Log');
    expect(stderr.buffered()).toBe('');
  });
});
