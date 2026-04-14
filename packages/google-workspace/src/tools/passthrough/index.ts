// T13 passthrough tool registrations — currently just `gws_execute`, the
// single escape-hatch tool that forwards argv to gws for any Discovery method
// not covered by the 22 vendor helpers or 12 shims.
//
// Call `registerPassthroughTools()` once at server bootstrap (before
// `finalizeRegistry()`). Tests that exercise the tool directly import
// `gwsExecute` from the module file rather than going through the registry.

import { registerTool } from '../registry.js';
import type { AnyToolDef } from '../types.js';

import { gwsExecute } from './gws-execute.js';

/**
 * Ordered list of every passthrough tool. Kept as a top-level const so the
 * MCP emitter and registration tests can both iterate it without importing
 * the underlying tool module twice.
 */
export const PASSTHROUGH_TOOLS: readonly AnyToolDef[] = [
  gwsExecute as unknown as AnyToolDef,
];

/**
 * Register the passthrough tool(s) with the shared registry. Throws
 * `registry_duplicate_name` on a second call within the same process unless
 * the test helper `__resetRegistryForTests()` has run in between — which
 * matches the vendor / shim registration contract.
 */
export function registerPassthroughTools(): void {
  registerTool(gwsExecute);
}

// Re-export the tool for direct test imports.
export { gwsExecute };
