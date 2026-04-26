#!/usr/bin/env node
// Tiny MCP fixture server for B5 (mcp/spawnClient) tests.
//
// Behaviour modes — selected via env vars at spawn time:
//
//   FIXTURE_MODE=happy        (default) → respond to init + concierge_info
//                                          with a known buildId/buildTime
//   FIXTURE_MODE=init-hang             → never respond to init; just sleep
//   FIXTURE_MODE=tool-hang             → respond to init; never respond to
//                                          concierge_info
//   FIXTURE_MODE=tool-error            → respond to init; concierge_info
//                                          returns isError + text envelope
//                                          (mirrors the @concierge/core
//                                          error-path convention)
//
// FIXTURE_BUILD_ID / FIXTURE_BUILD_TIME let the happy-path test assert the
// returned ConciergeInfo matches the values the fixture was started with.
//
// Implementation hops on the real SDK Server + StdioServerTransport, same
// shape as `packages/google-workspace/src/mcp/server.ts`. ~50 lines of
// behaviour, plus boilerplate.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  InitializeRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const mode = process.env.FIXTURE_MODE ?? 'happy';
const buildId = process.env.FIXTURE_BUILD_ID ?? 'fixture-build-001';
const buildTime = process.env.FIXTURE_BUILD_TIME ?? '2026-04-25T00:00:00Z';

const server = new Server(
  { name: 'concierge-fixture', version: '0.0.0-fixture' },
  { capabilities: { tools: {} } },
);

// init-hang: intercept the initialize handler with a never-resolving promise
// BEFORE the SDK's default handler runs. setRequestHandler overrides the
// internal default per the SDK source.
if (mode === 'init-hang') {
  server.setRequestHandler(InitializeRequestSchema, () => new Promise(() => {}));
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'concierge_info',
      description: 'Return build identity.',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'concierge_info') {
    return {
      content: [{ type: 'text', text: `unknown tool: ${request.params.name}` }],
      isError: true,
    };
  }
  if (mode === 'tool-hang') {
    return new Promise(() => {});
  }
  if (mode === 'tool-error') {
    return {
      content: [
        { type: 'text', text: 'simulated server-side failure for B5 test' },
      ],
      isError: true,
    };
  }
  // happy
  const data = { buildId, buildTime, extraField: 'tolerated' };
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
    structuredContent: data,
    isError: false,
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
