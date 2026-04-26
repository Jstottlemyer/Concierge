#!/usr/bin/env node
// Verify-test wrapper around mcp-server.js. Re-imports the same fixture but
// under a distinct filename so the spawnClient.test.ts orphan-detection
// regex (`fixtures/mcp-server\.js`) doesn't match processes spawned by
// verify.test.ts. Identical behavior; only the path differs.
import './mcp-server.js';
