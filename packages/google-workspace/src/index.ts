// Concierge MCP server — entry point for the @concierge/google-workspace
// vendor package.
//
// Registers every tool (currently 42) + Read-Only middleware, freezes the
// registry, attaches an stdio transport, and runs.
//
// stdout is reserved for MCP stdio transport framing; every diagnostic goes
// to stderr. Fatal bootstrap errors exit with status 1 after logging.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createConciergeServer } from './mcp/server.js';
import { getAllTools } from './tools/registry.js';

const VENDOR_VERSION =
  typeof __CONCIERGE_VENDOR_VERSION__ !== 'undefined' ? __CONCIERGE_VENDOR_VERSION__ : '0.0.0-dev';

/** Shape reported by `bootstrap()` — retained so legacy smoke tests still compile. */
export interface ConciergeBootstrap {
  readonly name: string;
  readonly version: string;
  readonly sdkLoaded: boolean;
}

/**
 * Diagnostic-only bootstrap snapshot. Real server wiring happens in `main()`.
 * Exported for the existing smoke test and for any in-process consumer that
 * needs to confirm module identity without starting a transport. Version is
 * injected at build time via tsup `define`.
 */
export function bootstrap(): ConciergeBootstrap {
  return {
    name: '@concierge/google-workspace',
    version: VENDOR_VERSION,
    sdkLoaded: true,
  };
}

/**
 * Start the stdio MCP server. Resolves when the transport closes — i.e., when
 * the client disconnects. Any throw bubbles to the caller (see the module-
 * level catch) so a failed bootstrap cleanly exits the process.
 */
export async function main(): Promise<void> {
  const server = createConciergeServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`concierge-mcp ready (tools=${String(getAllTools().length)})\n`);
}

// Detect whether this module was invoked as the process entry point. Import
// side-effects should be free of spawning the transport — tests import
// `bootstrap()` without wanting a server on stdin/stdout.
const isEntryPoint = ((): boolean => {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  // import.meta.url is a file:// URL; strip the scheme for comparison.
  try {
    const url = new URL(import.meta.url);
    return url.pathname === entry || url.pathname.endsWith('/dist/index.js');
  } catch {
    return false;
  }
})();

if (isEntryPoint) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`concierge-mcp fatal: ${message}\n`);
    process.exit(1);
  });
}
