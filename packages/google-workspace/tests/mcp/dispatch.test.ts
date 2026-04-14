// MCP dispatch tests — Wave 10.
//
// Drives `dispatchToolCall` directly (not through a transport) so assertions
// on the envelope shape are precise. Covers:
//   - Unknown tool → validation_error envelope.
//   - Input parse failure → validation_error with Zod issue trail.
//   - Successful invoke → structured content + isError=false.
//   - Tool-returned error envelope → isError=true.
//   - Redaction of OAuth tokens in returned payloads (defense-in-depth).

import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod/v3';

import { dispatchToolCall } from '../../src/mcp/dispatch.js';
import { __resetRegistryForTests, registerTool } from '../../src/tools/registry.js';
import type { ToolContext, ToolDef } from '../../src/tools/types.js';

const NOW = '2025-01-01T00:00:00.000Z';

function ctx(): ToolContext {
  return { now: NOW };
}

/** Read the JSON payload from an MCP text content block. */
function parsePayload(content: ReadonlyArray<{ type: string; text: string }>): unknown {
  const first = content[0];
  if (first === undefined || first.type !== 'text') {
    throw new Error(`expected first content block to be text, got ${String(first?.type)}`);
  }
  return JSON.parse(first.text);
}

describe('dispatchToolCall', () => {
  beforeEach(() => {
    __resetRegistryForTests();
  });

  it('returns validation_error for unknown tool names', async () => {
    const result = await dispatchToolCall('no_such_tool', {}, ctx());
    expect(result.isError).toBe(true);
    const payload = parsePayload(result.content) as Record<string, unknown>;
    expect(payload['ok']).toBe(false);
    expect(payload['error_code']).toBe('validation_error');
    expect(String(payload['message'])).toContain('no_such_tool');
  });

  it('returns validation_error when arguments fail schema parse', async () => {
    const tool: ToolDef<{ email: string }, { ok: boolean }> = {
      name: 'needs_email',
      description:
        'Validates an email shape. Use when exercising the dispatcher parse path. For real tool behavior, prefer any other tool.',
      service: 'management',
      readonly: true,
      input: z.object({ email: z.string().email() }),
      output: z.object({ ok: z.boolean() }),
      invoke: async () => ({ ok: true, data: { ok: true } }),
    };
    registerTool(tool);

    const result = await dispatchToolCall('needs_email', { email: 'not-an-email' }, ctx());
    expect(result.isError).toBe(true);
    const payload = parsePayload(result.content) as Record<string, unknown>;
    expect(payload['error_code']).toBe('validation_error');
    // Zod issue trail includes the path that failed.
    expect(String(payload['message'])).toContain('email');
  });

  it('accepts missing arguments for zero-input tools (coerced to {})', async () => {
    const tool: ToolDef<Record<string, never>, { ok: boolean }> = {
      name: 'no_args',
      description:
        'Returns ok=true. Use when exercising the dispatcher parse path for empty input. For real tool behavior, prefer any other tool.',
      service: 'management',
      readonly: true,
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      invoke: async () => ({ ok: true, data: { ok: true } }),
    };
    registerTool(tool);

    const result = await dispatchToolCall('no_args', undefined, ctx());
    expect(result.isError).toBe(false);
  });

  it('returns success envelope with structured data on tool success', async () => {
    const tool: ToolDef<{ n: number }, { double: number }> = {
      name: 'doubler',
      description:
        'Doubles a number. Use when exercising the dispatcher happy path. For real tool behavior, prefer any other tool.',
      service: 'management',
      readonly: true,
      input: z.object({ n: z.number() }),
      output: z.object({ double: z.number() }),
      invoke: async (args) => ({ ok: true, data: { double: args.n * 2 } }),
    };
    registerTool(tool);

    const result = await dispatchToolCall('doubler', { n: 21 }, ctx());
    expect(result.isError).toBe(false);
    const payload = parsePayload(result.content) as { ok: boolean; data: { double: number } };
    expect(payload.ok).toBe(true);
    expect(payload.data.double).toBe(42);
    // structuredContent is the UNWRAPPED data so it matches the tool's declared
    // outputSchema (required by Claude Desktop's response validation).
    // The {ok, data} envelope lives only in the text content above.
    expect(result.structuredContent).toEqual({ double: 42 });
  });

  it('propagates tool-level failure envelopes with isError=true', async () => {
    const tool: ToolDef<Record<string, never>, { ok: boolean }> = {
      name: 'always_fails',
      description:
        'Always fails. Use when exercising the dispatcher error path. For real tool behavior, prefer any other tool.',
      service: 'management',
      readonly: true,
      input: z.object({}),
      output: z.object({ ok: z.boolean() }),
      invoke: async () => ({
        ok: false,
        error: {
          ok: false as const,
          error_code: 'gws_error',
          message: 'simulated failure',
        },
      }),
    };
    registerTool(tool);

    const result = await dispatchToolCall('always_fails', {}, ctx());
    expect(result.isError).toBe(true);
    const payload = parsePayload(result.content) as Record<string, unknown>;
    expect(payload['error_code']).toBe('gws_error');
    expect(payload['message']).toBe('simulated failure');
  });

  it('structuredContent matches tool.output schema (not wrapped in envelope)', async () => {
    // Regression coverage for the v0.1.0 bug: dispatchToolCall used to emit
    // structuredContent = { ok: true, data: { x: 42 } }, which failed
    // Claude Desktop's output-schema validation and surfaced as
    // "Tool execution failed" despite the server producing a successful
    // payload. The contract per MCP spec: structuredContent MUST match the
    // tool's declared outputSchema (i.e., the unwrapped `data`); the
    // {ok, data} envelope lives only in the text content.
    const outputSchema = z.object({ x: z.number() }).strict();
    const tool: ToolDef<Record<string, never>, { x: number }> = {
      name: 'structured_content_check',
      description:
        'Returns {x: 42}. Use when verifying structuredContent matches the declared outputSchema. For real tool behavior, prefer any other tool.',
      service: 'management',
      readonly: true,
      input: z.object({}),
      output: outputSchema,
      invoke: async () => ({ ok: true, data: { x: 42 } }),
    };
    registerTool(tool);

    const result = await dispatchToolCall('structured_content_check', {}, ctx());
    expect(result.isError).toBe(false);
    // Exact shape — not the {ok, data} envelope.
    expect(result.structuredContent).toEqual({ x: 42 });
    // And it round-trips through the declared outputSchema.
    const parsed = outputSchema.safeParse(result.structuredContent);
    expect(parsed.success).toBe(true);
  });

  it('redacts OAuth tokens appearing in tool output (defense-in-depth)', async () => {
    const tool: ToolDef<Record<string, never>, { leaked: string }> = {
      name: 'token_leaker',
      description:
        'Returns a fake OAuth token. Use when verifying redaction behavior of the dispatcher. For real tool behavior, prefer any other tool.',
      service: 'management',
      readonly: true,
      input: z.object({}),
      output: z.object({ leaked: z.string() }),
      invoke: async () => ({ ok: true, data: { leaked: 'ya29.A0AfB_byZverySecretTokenValue' } }),
    };
    registerTool(tool);

    const result = await dispatchToolCall('token_leaker', {}, ctx());
    expect(result.isError).toBe(false);
    const payload = parsePayload(result.content) as { data: { leaked: string } };
    expect(payload.data.leaked).toBe('[REDACTED]');
  });
});
