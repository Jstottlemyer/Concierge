// MCP server wiring tests — Wave 10.
//
// Uses the SDK's in-memory transport pair to drive a real Client <-> Server
// round trip without touching stdio. Covers:
//   - Every registered tool (22 vendor + 12 shims + 1 passthrough + 7 management
//     = 42) surfaces in `tools/list`.
//   - Each emitted descriptor conforms to the Decision #13.5 description
//     lint (no warnings from `auditAllDescriptions`).
//   - The server advertises tool capability.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeEach, describe, expect, it } from 'vitest';

import { createConciergeServer } from '../../src/mcp/server.js';
import { auditAllDescriptions, auditFailures } from '../../src/tools/mcp-schema.js';
import { __resetRegistryForTests, getAllTools } from '../../src/tools/registry.js';

async function buildConnectedClient(): Promise<Client> {
  const server = createConciergeServer({
    serverInfo: { name: 'concierge-test', version: '0.0.0-test' },
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);
  return client;
}

describe('createConciergeServer', () => {
  beforeEach(() => {
    __resetRegistryForTests();
  });

  it('registers 42 tools (22 vendor + 12 shims + 1 passthrough + 7 management)', async () => {
    const client = await buildConnectedClient();
    try {
      const list = await client.listTools();
      expect(list.tools).toHaveLength(42);
    } finally {
      await client.close();
    }
  });

  it('emits Decision #13.5-compliant descriptions for every registered tool', async () => {
    // Run through the server once so the registry is populated in the same
    // order the server uses. `getAllTools()` returns the live (frozen) view.
    await buildConnectedClient();
    const audit = auditAllDescriptions(getAllTools());
    const failures = auditFailures(audit);
    if (failures.length > 0) {
      const summary = failures
        .map((f) => `${f.tool}: ${f.result.warnings.join('; ')}`)
        .join('\n');
      throw new Error(`Description lint warnings for ${String(failures.length)} tools:\n${summary}`);
    }
    expect(failures).toHaveLength(0);
  });

  it('advertises tools capability on initialize', async () => {
    const client = await buildConnectedClient();
    try {
      const capabilities = client.getServerCapabilities();
      expect(capabilities).toBeDefined();
      expect(capabilities?.tools).toBeDefined();
    } finally {
      await client.close();
    }
  });

  it('each emitted tool carries an object-typed inputSchema', async () => {
    const client = await buildConnectedClient();
    try {
      const list = await client.listTools();
      for (const tool of list.tools) {
        expect(tool.inputSchema.type).toBe('object');
        expect(typeof tool.name).toBe('string');
        expect(tool.name.length).toBeGreaterThan(0);
        expect(typeof tool.description).toBe('string');
        expect((tool.description ?? '').length).toBeGreaterThan(0);
      }
    } finally {
      await client.close();
    }
  });
});
