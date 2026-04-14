// MCP `tools/call` dispatcher — Wave 10 T-server.
//
// Converts a single `tools/call` request into the MCP result envelope:
//
//   1. Look up the tool by name — unknown names return a `validation_error`
//      envelope rather than letting the underlying SDK throw.
//   2. Parse `args` through the tool's Zod input schema. Any parse failure is
//      collapsed into a `validation_error` envelope whose message enumerates
//      the Zod issues (path + message) for debuggability.
//   3. Invoke the tool — this goes through the Read-Only middleware wrapper
//      already applied at bootstrap, so we do not re-implement gating here.
//   4. Redact the returned result with `redact()` before emitting. Tools
//      themselves should not be leaking tokens, but defense-in-depth is cheap.
//   5. Encode the ToolResult as an MCP `CallToolResult`:
//      - success → `{ content: [{ type: 'text', text: JSON.stringify(data) }],
//                      structuredContent: data, isError: false }`
//      - failure → same shape but `isError: true` and the error envelope is
//                  the payload.
//
// Unhandled throws from `tool.invoke` are NOT caught here — the server layer
// translates them into an envelope at a higher level so the stack trace
// reaches stderr unredacted for operator debugging.

import { z } from 'zod/v3';

import { makeError, type ErrorEnvelope } from '@concierge/core/errors';
import { redact } from '../log/redact.js';
import { getToolByName } from '../tools/registry.js';
import type { ToolContext, ToolResult } from '../tools/types.js';

/**
 * Result shape matching the MCP `CallToolResult` contract. Kept minimal — the
 * spec allows richer content arrays (image, audio, resource links), but
 * Concierge only emits a single text block carrying the JSON-encoded payload.
 */
export interface CallToolContent {
  readonly type: 'text';
  readonly text: string;
}

export interface CallToolResult {
  readonly content: readonly CallToolContent[];
  readonly structuredContent?: unknown;
  readonly isError: boolean;
}

/**
 * Turn Zod issues into a single, skimmable message for the `validation_error`
 * envelope. Format: `path: message; path: message`. Missing paths collapse to
 * `(root)` so the reader never sees a bare colon.
 */
function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

/**
 * Encode a successful `ToolResult` as an MCP `CallToolResult`.
 *
 * MCP spec: `structuredContent` SHOULD match the tool's declared `outputSchema`.
 * Tools declare outputSchema as the raw data shape, so on success we put the
 * unwrapped data there. The text content keeps the `{ok: true, data: ...}`
 * envelope for human-readable inspection.
 */
function encodeSuccess(data: unknown): CallToolResult {
  const redactedData = redact(data);
  const wrapped = { ok: true as const, data: redactedData };
  return {
    content: [{ type: 'text', text: JSON.stringify(wrapped, null, 2) }],
    structuredContent: redactedData as Record<string, unknown>,
    isError: false,
  };
}

/**
 * Encode a failed `ToolResult` as an MCP `CallToolResult`.
 *
 * We intentionally omit `structuredContent` on the error path: the tool's
 * `outputSchema` describes successful data only, so attempting to serialize
 * the error envelope there causes strict clients (like Claude Desktop) to
 * reject the response as "Tool execution failed" despite our server having
 * produced a valid error report. The error envelope is the text content and
 * `isError: true` signals the failure.
 */
function encodeError(envelope: ErrorEnvelope): CallToolResult {
  const redactedEnvelope = redact(envelope);
  return {
    content: [{ type: 'text', text: JSON.stringify(redactedEnvelope, null, 2) }],
    isError: true,
  };
}

/**
 * Dispatch a `tools/call` request.
 *
 * Contract (see module header):
 *   - Unknown tool → `validation_error` envelope.
 *   - Input parse failure → `validation_error` envelope with issue trail.
 *   - Success → success envelope with redacted `data`.
 *   - Handled failure → the tool's own error envelope, redacted again.
 *   - Unhandled throw → propagates; the SDK's request handler translates.
 */
export async function dispatchToolCall(
  name: string,
  args: unknown,
  ctx: ToolContext,
): Promise<CallToolResult> {
  const tool = getToolByName(name);
  if (tool === undefined) {
    const envelope = makeError({
      error_code: 'validation_error',
      message: `Unknown tool: ${name}`,
    });
    return encodeError(envelope);
  }

  // Normalize missing arguments to an empty object so tools that take no input
  // (e.g., `list_accounts`) still parse successfully.
  const rawArgs: unknown = args === undefined || args === null ? {} : args;

  const parsed = tool.input.safeParse(rawArgs);
  if (!parsed.success) {
    const envelope = makeError({
      error_code: 'validation_error',
      message: `Invalid arguments for ${name}: ${formatZodIssues(parsed.error)}`,
    });
    return encodeError(envelope);
  }

  // Cast through `never` — the registry stores tools with contravariant input
  // types erased; the Zod schema just validated the concrete shape so calling
  // `invoke` with the parsed value is sound.
  const invokeArgs = parsed.data as unknown as never;
  const result: ToolResult<unknown> = await tool.invoke(invokeArgs, ctx);

  if (result.ok) {
    return encodeSuccess(result.data);
  }

  return encodeError(result.error as ErrorEnvelope);
}
