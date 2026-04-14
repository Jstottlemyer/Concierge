// MCP server factory — Wave 10 T-server.
//
// Wires every moving piece from Waves 1-9 into a functional MCP server:
//
//   1. Construct a `Server` from `@modelcontextprotocol/sdk`.
//   2. Register every tool module (vendor helpers, shims, passthrough,
//      management) in a known order so `tools/list` is deterministic.
//   3. Apply the Read-Only middleware so every write tool honours the
//      per-account read_only flag without each tool reimplementing the check.
//   4. Freeze the registry. After this point any stray `registerTool` call
//      throws — preventing late registrations from escaping `tools/list`.
//   5. Install two handlers:
//        - `tools/list` → emit the MCP-shaped tool descriptors.
//        - `tools/call` → dispatch into the registry, redact, return.
//   6. Return the Server. The caller wires the transport.
//
// The factory is idempotent within a process only if `__resetRegistryForTests`
// ran between calls — otherwise the duplicate-name check in `registerTool`
// throws on the second pass. Production calls this exactly once, before
// connecting the stdio transport. Tests build short-lived servers around
// `__resetRegistryForTests()` boundaries.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { makeError } from '@concierge/core/errors';
import { finalizeRegistry, getAllTools } from '../tools/registry.js';
import { registerManagementTools } from '../tools/management/index.js';
import { applyReadOnlyMiddleware } from '../tools/middleware/read-only.js';
import { toMcpToolList } from '../tools/mcp-schema.js';
import { registerPassthroughTools } from '../tools/passthrough/index.js';
import { registerShimTools } from '../tools/shims/index.js';
import { registerVendorTools } from '../tools/vendor/index.js';

import { dispatchToolCall } from './dispatch.js';
import type { SendNotification } from './progress.js';
import { buildToolContext } from './tool-context.js';

/** Identity fields reported to clients during initialize. */
export interface ConciergeServerInfo {
  readonly name: string;
  readonly version: string;
}

/**
 * Default identity — version is injected at build time via tsup `define`
 * (`__CONCIERGE_VENDOR_VERSION__`). In dev (ts-node / vitest) the identifier
 * isn't defined; the conditional picks up a '0.0.0-dev' fallback so typecheck
 * and unit tests pass without needing the build step.
 */
const VENDOR_VERSION =
  typeof __CONCIERGE_VENDOR_VERSION__ !== 'undefined' ? __CONCIERGE_VENDOR_VERSION__ : '0.0.0-dev';
const DEFAULT_SERVER_INFO: ConciergeServerInfo = {
  name: 'concierge-google-workspace-mcp',
  version: VENDOR_VERSION,
};

/** Options for `createConciergeServer`. Test-only, empty by default. */
export interface CreateConciergeServerOptions {
  /** Override identity (tests supply a stable value). */
  readonly serverInfo?: ConciergeServerInfo;
  /** Skip tool registration — tests using pre-populated registries pass true. */
  readonly skipRegistration?: boolean;
  /** Skip middleware — tests that want to inspect raw tools pass true. */
  readonly skipMiddleware?: boolean;
  /** Skip registry freeze — tests that mutate after construction pass true. */
  readonly skipFreeze?: boolean;
}

/**
 * Build + wire a ready-to-connect MCP `Server`. Caller wires the transport.
 *
 * Throws any `ConciergeError` that registration surfaces — a bad tool
 * definition is a developer-time bug and should stop bootstrap immediately.
 */
export function createConciergeServer(options: CreateConciergeServerOptions = {}): Server {
  const serverInfo = options.serverInfo ?? DEFAULT_SERVER_INFO;

  if (options.skipRegistration !== true) {
    registerVendorTools();
    registerShimTools();
    registerPassthroughTools();
    registerManagementTools();
  }

  if (options.skipMiddleware !== true) {
    applyReadOnlyMiddleware();
  }

  if (options.skipFreeze !== true) {
    finalizeRegistry();
  }

  const server = new Server(
    { name: serverInfo.name, version: serverInfo.version },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // `tools/list` — a frozen snapshot of every registered tool. No pagination
  // today; 40 tools comfortably fit in a single response and the MCP spec
  // permits `nextCursor` to be omitted when the full list is returned.
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const list = toMcpToolList(getAllTools());
    return { tools: [...list.tools] };
  });

  // `tools/call` — per-request context construction + dispatch. Unhandled
  // throws are translated into a last-resort `validation_error` envelope so
  // the client still gets a structured response.
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const progressToken: string | number | undefined =
      typeof extra._meta?.['progressToken'] === 'string' ||
      typeof extra._meta?.['progressToken'] === 'number'
        ? (extra._meta['progressToken'] as string | number)
        : undefined;

    // `extra.sendNotification` speaks the server's outbound notification
    // union. The progress emitter only needs the `notifications/progress`
    // method — wrap so the `send` callback matches our narrower signature.
    const sendNotification: SendNotification = async (method, params) => {
      await extra.sendNotification({
        method,
        params: params as Record<string, unknown>,
      });
    };

    const { ctx } = buildToolContext({
      progressToken,
      sendNotification,
    });

    try {
      const result = await dispatchToolCall(request.params.name, request.params.arguments, ctx);
      return {
        content: [...result.content],
        ...(result.structuredContent !== undefined
          ? { structuredContent: result.structuredContent as Record<string, unknown> }
          : {}),
        isError: result.isError,
      };
    } catch (err: unknown) {
      // Last-resort safety net: an unhandled throw inside invoke. Translate
      // to an envelope so the client never sees a raw JSON-RPC error for a
      // bug in our dispatch path. The trace still hits stderr.
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`concierge-mcp dispatch threw: ${message}\n`);
      const envelope = makeError({
        error_code: 'validation_error',
        message: `Internal dispatch error: ${message}`,
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(envelope, null, 2) }],
        structuredContent: envelope as unknown as Record<string, unknown>,
        isError: true,
      };
    }
  });

  return server;
}
