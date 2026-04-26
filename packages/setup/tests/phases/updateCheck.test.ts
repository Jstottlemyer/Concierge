// Tests for C9: phases/updateCheck.ts.
//
// We spin up a real loopback HTTP server per test (via `node:http`) instead
// of mocking `fetch`. The implementation uses Node's built-in fetch, which
// is non-trivial to monkey-patch reliably across vitest worker boundaries,
// and the local server gives us authentic header / status / timeout
// behavior. Each test gets a fresh server bound to `localhost:0` (kernel-
// assigned port) and a fresh tempdir for the cache file, so they remain
// isolated under `vitest --threads`.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import * as os from 'node:os';
import { dirname, join } from 'node:path';
import type { AddressInfo } from 'node:net';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  checkForUpdate,
  isNewerVersion,
} from '../../src/phases/updateCheck.js';

interface MockServerHandle {
  url: string;
  close: () => Promise<void>;
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

async function startServer(handler: Handler): Promise<MockServerHandle> {
  const server: Server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${addr.port}/`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        // Make sure no idle keep-alive sockets keep the server up.
        server.closeAllConnections?.();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

let tempDirs: string[] = [];
let servers: MockServerHandle[] = [];

function freshCachePath(): string {
  const dir = mkdtempSync(join(os.tmpdir(), 'concierge-updatecheck-'));
  tempDirs.push(dir);
  return join(dir, 'subdir', '.update-check'); // exercises mkdir recursion
}

beforeEach(() => {
  tempDirs = [];
  servers = [];
  // Default: not disabled. Individual tests may set this.
  delete process.env['CONCIERGE_SETUP_UPDATE_CHECK'];
});

afterEach(async () => {
  for (const s of servers) await s.close();
  for (const d of tempDirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
  delete process.env['CONCIERGE_SETUP_UPDATE_CHECK'];
});

describe('isNewerVersion', () => {
  it('compares MAJOR.MINOR.PATCH numerically and tolerates prefixes', () => {
    expect(isNewerVersion('v0.4.0', '0.3.9')).toBe(true);
    expect(isNewerVersion('release-v1.0.0', '0.99.99')).toBe(true);
    expect(isNewerVersion('0.3.0', '0.3.0')).toBe(false);
    expect(isNewerVersion('0.2.5', '0.3.0')).toBe(false);
    // 1.0.0 is newer than 1.0.0-rc.1 (semver §11).
    expect(isNewerVersion('1.0.0', '1.0.0-rc.1')).toBe(true);
    expect(isNewerVersion('1.0.0-rc.1', '1.0.0')).toBe(false);
    // Garbage in → false (conservative).
    expect(isNewerVersion('not-a-version', '0.1.0')).toBe(false);
    expect(isNewerVersion('0.1.0', 'not-a-version')).toBe(false);
  });
});

describe('checkForUpdate', () => {
  it('returns cache-hit when cache mtime is within TTL', async () => {
    const cachePath = freshCachePath();
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(
      cachePath,
      JSON.stringify({
        checkedAt: new Date().toISOString(),
        latestTag: 'v0.5.0',
        releaseUrl: 'https://example.invalid/release/0.5.0',
        currentVersion: '0.4.0',
        newer: true,
      }),
      'utf8',
    );

    // Server should NOT be called — fail loudly if it is.
    let hits = 0;
    const server = await startServer((_req, res) => {
      hits++;
      res.writeHead(500);
      res.end();
    });
    servers.push(server);

    const result = await checkForUpdate({
      currentVersion: '0.4.0',
      cachePath,
      apiUrl: server.url,
      cacheTtlMs: 60_000,
      timeoutMs: 1000,
    });

    expect(hits).toBe(0);
    expect(result.skipReason).toBe('cache-hit');
    expect(result.newer).toBe(true);
    expect(result.latestTag).toBe('v0.5.0');
  });

  it('fetches and reports newer=true when API returns a newer tag, and writes the cache', async () => {
    const cachePath = freshCachePath();
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          tag_name: 'release-v0.5.0',
          html_url: 'https://example.invalid/release/0.5.0',
        }),
      );
    });
    servers.push(server);

    const result = await checkForUpdate({
      currentVersion: '0.4.0',
      cachePath,
      apiUrl: server.url,
      cacheTtlMs: 60_000,
      timeoutMs: 1000,
    });

    expect(result.newer).toBe(true);
    expect(result.latestTag).toBe('release-v0.5.0');
    expect(result.releaseUrl).toBe('https://example.invalid/release/0.5.0');
    expect(result.skipReason).toBeUndefined();

    // Cache should now exist with the same payload.
    const cached = JSON.parse(await readFile(cachePath, 'utf8'));
    expect(cached.newer).toBe(true);
    expect(cached.latestTag).toBe('release-v0.5.0');
    expect(cached.currentVersion).toBe('0.4.0');
    expect(typeof cached.checkedAt).toBe('string');
  });

  it('reports newer=false and writes cache when API returns the same tag', async () => {
    const cachePath = freshCachePath();
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          tag_name: 'v0.4.0',
          html_url: 'https://example.invalid/release/0.4.0',
        }),
      );
    });
    servers.push(server);

    const result = await checkForUpdate({
      currentVersion: '0.4.0',
      cachePath,
      apiUrl: server.url,
      cacheTtlMs: 60_000,
      timeoutMs: 1000,
    });

    expect(result.newer).toBe(false);
    expect(result.latestTag).toBe('v0.4.0');
    expect(result.skipReason).toBeUndefined();

    const cached = JSON.parse(await readFile(cachePath, 'utf8'));
    expect(cached.newer).toBe(false);
    expect(cached.latestTag).toBe('v0.4.0');
  });

  it('reports newer=false when API returns an older tag', async () => {
    const cachePath = freshCachePath();
    const server = await startServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          tag_name: 'v0.3.0',
          html_url: 'https://example.invalid/release/0.3.0',
        }),
      );
    });
    servers.push(server);

    const result = await checkForUpdate({
      currentVersion: '0.4.0',
      cachePath,
      apiUrl: server.url,
      cacheTtlMs: 60_000,
      timeoutMs: 1000,
    });

    expect(result.newer).toBe(false);
    expect(result.latestTag).toBe('v0.3.0');
  });

  it('reports skipReason=rate-limited on 403 with X-RateLimit-Remaining: 0', async () => {
    const cachePath = freshCachePath();
    const server = await startServer((_req, res) => {
      res.writeHead(403, {
        'Content-Type': 'application/json',
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': '9999999999',
      });
      res.end(JSON.stringify({ message: 'API rate limit exceeded' }));
    });
    servers.push(server);

    const result = await checkForUpdate({
      currentVersion: '0.4.0',
      cachePath,
      apiUrl: server.url,
      cacheTtlMs: 60_000,
      timeoutMs: 1000,
    });

    expect(result.skipReason).toBe('rate-limited');
    expect(result.newer).toBe(false);

    // Rate-limit responses must NOT be cached (else a 24h cache TTL would
    // suppress retry far longer than the actual reset window).
    let cacheExists = true;
    try {
      statSync(cachePath);
    } catch {
      cacheExists = false;
    }
    expect(cacheExists).toBe(false);
  });

  it('reports skipReason=network-error when the server takes longer than timeoutMs', async () => {
    const cachePath = freshCachePath();
    // Server intentionally delays its response well beyond the test's
    // configured timeoutMs. The test asserts checkForUpdate returns fast.
    const server = await startServer((_req, res) => {
      setTimeout(() => {
        try {
          res.writeHead(200);
          res.end('{}');
        } catch {
          // socket may already be aborted; that's fine
        }
      }, 5000);
    });
    servers.push(server);

    const start = Date.now();
    const result = await checkForUpdate({
      currentVersion: '0.4.0',
      cachePath,
      apiUrl: server.url,
      cacheTtlMs: 60_000,
      timeoutMs: 100,
    });
    const elapsed = Date.now() - start;

    expect(result.skipReason).toBe('network-error');
    expect(result.newer).toBe(false);
    // We must time out fast — well under the 5s server delay.
    expect(elapsed).toBeLessThan(2000);
  });

  it('returns check-disabled and never opens a socket when CONCIERGE_SETUP_UPDATE_CHECK=0', async () => {
    process.env['CONCIERGE_SETUP_UPDATE_CHECK'] = '0';
    const cachePath = freshCachePath();

    let hits = 0;
    const server = await startServer((_req, res) => {
      hits++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ tag_name: 'v9.9.9', html_url: 'x' }));
    });
    servers.push(server);

    const result = await checkForUpdate({
      currentVersion: '0.4.0',
      cachePath,
      apiUrl: server.url,
      cacheTtlMs: 60_000,
      timeoutMs: 1000,
    });

    expect(hits).toBe(0);
    expect(result.skipReason).toBe('check-disabled');
    expect(result.newer).toBe(false);
  });

  it('falls back to HTTP when cache is stale (mtime older than TTL)', async () => {
    const cachePath = freshCachePath();
    await mkdir(dirname(cachePath), { recursive: true });
    writeFileSync(
      cachePath,
      JSON.stringify({
        checkedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        latestTag: 'v0.1.0',
        currentVersion: '0.4.0',
        newer: false,
      }),
      'utf8',
    );
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    utimesSync(cachePath, twoDaysAgo, twoDaysAgo);

    let hits = 0;
    const server = await startServer((_req, res) => {
      hits++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          tag_name: 'v0.5.0',
          html_url: 'https://example.invalid/release/0.5.0',
        }),
      );
    });
    servers.push(server);

    const result = await checkForUpdate({
      currentVersion: '0.4.0',
      cachePath,
      apiUrl: server.url,
      cacheTtlMs: 24 * 60 * 60 * 1000,
      timeoutMs: 1000,
    });

    expect(hits).toBe(1);
    expect(result.newer).toBe(true);
    expect(result.latestTag).toBe('v0.5.0');
    expect(result.skipReason).toBeUndefined();
  });
});
