// MCP schema emitter + description linter tests — T4.
//
// Split into two concerns:
//   1. `toMcpToolList` shape correctness (valid JSON Schema for MCP clients)
//   2. `validateDescription` / `auditAllDescriptions` behavior (Decision #13.5)

import { describe, expect, it } from 'vitest';
import { z } from 'zod/v3';

import {
  auditAllDescriptions,
  auditFailures,
  toMcpToolList,
  validateDescription,
} from '../../src/tools/mcp-schema.js';
import type { ToolDef } from '../../src/tools/types.js';

// Canonical description from plan §13.5 (gmail_send sample) — used as a
// known-good baseline across the tests.
const CANONICAL_DESCRIPTION =
  'Sends a new Gmail message from the authenticated account. Use when the user asks to send, reply to, or forward an email. Returns the sent message ID. For reading, searching, drafting, or listing email, prefer claude.ai\'s hosted Gmail connector.';

function makeTool(overrides: Partial<ToolDef> = {}): ToolDef {
  return {
    name: 'gmail_send',
    description: CANONICAL_DESCRIPTION,
    service: 'gmail',
    readonly: false,
    input: z.object({
      to: z.string().email(),
      subject: z.string(),
      body: z.string(),
    }),
    output: z.object({
      message_id: z.string(),
    }),
    invoke: async () => ({ ok: true, data: { message_id: 'abc' } }),
    ...overrides,
  } as ToolDef;
}

describe('toMcpToolList', () => {
  it('emits a tools/list body with JSON-Schema inputSchema objects', () => {
    const result = toMcpToolList([makeTool()]);
    expect(result.tools).toHaveLength(1);

    const [tool] = result.tools;
    expect(tool).toBeDefined();
    if (!tool) return;

    expect(tool.name).toBe('gmail_send');
    expect(tool.description).toBe(CANONICAL_DESCRIPTION);
    expect(tool.inputSchema.type).toBe('object');

    // Properties emitted from the Zod shape.
    const props = tool.inputSchema.properties;
    expect(props).toBeDefined();
    expect(props).toHaveProperty('to');
    expect(props).toHaveProperty('subject');
    expect(props).toHaveProperty('body');

    // All three fields are required.
    expect(tool.inputSchema.required).toEqual(
      expect.arrayContaining(['to', 'subject', 'body']),
    );

    // No `$schema` leakage — we strip it in the emitter.
    expect(tool.inputSchema).not.toHaveProperty('$schema');
  });

  it('emits an outputSchema when the Zod output is an object', () => {
    const [tool] = toMcpToolList([makeTool()]).tools;
    expect(tool).toBeDefined();
    if (!tool) return;

    expect(tool.outputSchema).toBeDefined();
    expect(tool.outputSchema?.type).toBe('object');
    expect(tool.outputSchema?.properties).toHaveProperty('message_id');
  });

  it('omits outputSchema for non-object output types', () => {
    const tool = makeTool({ output: z.string() });
    const [emitted] = toMcpToolList([tool]).tools;
    expect(emitted).toBeDefined();
    if (!emitted) return;
    expect(emitted.outputSchema).toBeUndefined();
  });

  it('wraps non-object input roots under a synthetic `value` property', () => {
    const tool = makeTool({ input: z.string() });
    const [emitted] = toMcpToolList([tool]).tools;
    expect(emitted).toBeDefined();
    if (!emitted) return;
    expect(emitted.inputSchema.type).toBe('object');
    expect(emitted.inputSchema.properties).toHaveProperty('value');
    expect(emitted.inputSchema.required).toEqual(['value']);
  });

  it('surfaces readonly as annotations.readOnlyHint', () => {
    const readOnly = toMcpToolList([makeTool({ readonly: true })]).tools[0];
    const writing = toMcpToolList([makeTool({ readonly: false })]).tools[0];
    expect(readOnly?.annotations?.readOnlyHint).toBe(true);
    expect(writing?.annotations?.readOnlyHint).toBe(false);
  });

  it('preserves registration order', () => {
    const tools: ToolDef[] = [
      makeTool({ name: 'a_one' }),
      makeTool({ name: 'a_two' }),
      makeTool({ name: 'a_three' }),
    ];
    const emitted = toMcpToolList(tools).tools.map((t) => t.name);
    expect(emitted).toEqual(['a_one', 'a_two', 'a_three']);
  });
});

describe('validateDescription (Decision #13.5)', () => {
  it('passes the canonical 3-part sample', () => {
    const result = validateDescription(CANONICAL_DESCRIPTION);
    expect(result.ok).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('warns on short descriptions', () => {
    const result = validateDescription('Sends a message.');
    expect(result.ok).toBe(false);
    expect(result.warnings.some((w) => /chars/.test(w))).toBe(true);
  });

  it('warns when the first sentence is not imperative', () => {
    const terse =
      'sends a gmail message from the authenticated account. Use when the user asks to send.';
    const result = validateDescription(terse);
    // No capital-initial imperative verb — should warn on "imperative".
    expect(result.warnings.some((w) => /imperative/i.test(w))).toBe(true);
  });

  it('warns when there is no "Use when / Use to / Use for" trigger phrase', () => {
    const noTrigger =
      'Sends a new Gmail message from the authenticated account. Returns the sent message ID without additional guidance for the caller whatsoever.';
    const result = validateDescription(noTrigger);
    expect(result.warnings.some((w) => /use when/i.test(w))).toBe(true);
  });

  it('warns when mentioning a competing surface without a routing hint', () => {
    const noHint =
      'Sends a new Gmail message from the authenticated account. Use when the user asks to send an email through the native Gmail connector surface.';
    const result = validateDescription(noHint);
    expect(result.warnings.some((w) => /routing hint/i.test(w))).toBe(true);
  });

  it('does not require a routing hint when no competing surface is mentioned', () => {
    // Matches the drive_upload canonical sample — no competing native tool.
    const noCompetitor =
      'Uploads a local file to Google Drive with optional metadata. Use when the user wants to put a file into Drive. Returns the uploaded file ID.';
    const result = validateDescription(noCompetitor);
    expect(result.ok).toBe(true);
  });
});

describe('auditAllDescriptions', () => {
  it('returns one entry per tool with result.ok reflecting lint state', () => {
    const good = makeTool({ name: 'good_tool' });
    const bad = makeTool({ name: 'bad_tool', description: 'Too short.' });
    const audit = auditAllDescriptions([good, bad]);

    expect(audit).toHaveLength(2);
    expect(audit[0]?.tool).toBe('good_tool');
    expect(audit[0]?.result.ok).toBe(true);
    expect(audit[1]?.tool).toBe('bad_tool');
    expect(audit[1]?.result.ok).toBe(false);
  });

  it('auditFailures returns only entries with warnings', () => {
    const good = makeTool({ name: 'good_tool' });
    const bad = makeTool({ name: 'bad_tool', description: 'Too short.' });
    const failures = auditFailures(auditAllDescriptions([good, bad]));
    expect(failures).toHaveLength(1);
    expect(failures[0]?.tool).toBe('bad_tool');
  });
});
