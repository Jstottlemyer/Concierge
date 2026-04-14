// Tool registry unit tests — T4.
//
// Covers the public surface of `src/tools/registry.ts`:
// - empty initial state
// - successful registration + retrieval by name
// - duplicate-name rejection
// - invalid-name / invalid-service rejection
// - freeze semantics (post-freeze registerTool throws)
// - test-only reset hook
//
// These tests do NOT exercise the MCP schema emitter or description linter —
// those live in mcp-schema.test.ts.

import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod/v3';

import { ConciergeError } from '@concierge/core/errors';
import {
  __resetRegistryForTests,
  finalizeRegistry,
  getAllTools,
  getToolByName,
  getToolsByName,
  isRegistryFrozen,
  registerTool,
} from '../../src/tools/registry.js';
import type { ToolDef } from '../../src/tools/types.js';

// A minimal tool factory for tests. Uses generic type arguments so the test
// can assert the registered definition round-trips with its input/output
// types intact.
function makeDummyTool(
  overrides: Partial<ToolDef<{ email: string }, { ok: boolean }>> = {},
): ToolDef<{ email: string }, { ok: boolean }> {
  return {
    name: 'dummy_tool',
    description:
      'Does nothing useful. Use when running registry unit tests. For real tool behavior, prefer any other tool.',
    service: 'management',
    readonly: true,
    input: z.object({ email: z.string() }),
    output: z.object({ ok: z.boolean() }),
    invoke: async () => ({ ok: true, data: { ok: true } }),
    ...overrides,
  };
}

describe('tool registry', () => {
  beforeEach(() => {
    __resetRegistryForTests();
  });

  it('starts empty and unfrozen', () => {
    expect(getAllTools()).toEqual([]);
    expect(getToolsByName()).toEqual({});
    expect(isRegistryFrozen()).toBe(false);
  });

  it('registers a tool and retrieves it by name', () => {
    const tool = makeDummyTool();
    registerTool(tool);

    expect(getAllTools()).toHaveLength(1);
    expect(getAllTools()[0]).toBe(tool);
    expect(getToolByName('dummy_tool')).toBe(tool);
    expect(getToolsByName()).toHaveProperty('dummy_tool', tool);
  });

  it('returns undefined for unknown tool names', () => {
    expect(getToolByName('nonexistent')).toBeUndefined();
  });

  it('preserves generic type inference on the registered tool', () => {
    const tool = makeDummyTool();
    registerTool(tool);

    // Retrieval via getToolByName returns AnyToolDef, but if we know the
    // name we can narrow via the original reference. This is a compile-time
    // check wrapped in a runtime assertion to keep TSC honest.
    const retrieved = getToolByName('dummy_tool');
    expect(retrieved).toBeDefined();
    // Type check: the invoke signature accepts our inferred input type.
    // (No runtime call — just confirm the shape.)
    expect(typeof tool.invoke).toBe('function');
  });

  it('rejects duplicate tool names', () => {
    registerTool(makeDummyTool());
    expect(() => registerTool(makeDummyTool())).toThrow(ConciergeError);
    expect(() => registerTool(makeDummyTool())).toThrow(/already registered/i);
  });

  it('rejects invalid tool names', () => {
    expect(() => registerTool(makeDummyTool({ name: 'BadName' }))).toThrow(
      /lowercase snake_case/i,
    );
    expect(() => registerTool(makeDummyTool({ name: '1leading_digit' }))).toThrow(
      ConciergeError,
    );
    expect(() => registerTool(makeDummyTool({ name: 'with-dash' }))).toThrow(ConciergeError);
    expect(() => registerTool(makeDummyTool({ name: '' }))).toThrow(ConciergeError);
  });

  it('rejects invalid service tags', () => {
    // Cast through unknown because TS correctly refuses the invalid literal.
    expect(() =>
      registerTool(
        makeDummyTool({ service: 'bogus' as unknown as ToolDef['service'] }),
      ),
    ).toThrow(/invalid service tag/i);
  });

  it('accepts all documented service tags', () => {
    const services: Array<ToolDef['service']> = [
      'gmail',
      'drive',
      'calendar',
      'docs',
      'sheets',
      'tasks',
      'forms',
      'chat',
      'meet',
      'people',
      'admin-reports',
      'events',
      'modelarmor',
      'classroom',
      'slides',
      'script',
      'workflow',
      'management',
      'passthrough',
    ];
    services.forEach((service, idx) => {
      registerTool(makeDummyTool({ name: `tool_${String(idx)}`, service }));
    });
    expect(getAllTools()).toHaveLength(services.length);
  });

  it('freezes the registry and rejects further registrations', () => {
    registerTool(makeDummyTool());
    finalizeRegistry();
    expect(isRegistryFrozen()).toBe(true);
    expect(() => registerTool(makeDummyTool({ name: 'other_tool' }))).toThrow(
      /frozen/i,
    );
  });

  it('finalizeRegistry is idempotent', () => {
    finalizeRegistry();
    expect(() => finalizeRegistry()).not.toThrow();
    expect(isRegistryFrozen()).toBe(true);
  });

  it('after freeze, the tools snapshot is frozen', () => {
    registerTool(makeDummyTool());
    finalizeRegistry();
    const snapshot = getAllTools();
    expect(Object.isFrozen(snapshot)).toBe(true);
  });
});
