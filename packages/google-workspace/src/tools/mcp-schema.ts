// MCP tools/list emitter and description linter.
//
// Wave 2 — T4. Two concerns live here:
//
//   1. `toMcpToolList(tools)` converts a registry `ToolDef[]` into the shape
//      the MCP SDK expects on a `tools/list` response: `{ tools: McpTool[] }`
//      where each `McpTool.inputSchema` is JSON Schema (type: 'object').
//
//   2. `validateDescription(description)` enforces Decision #13.5's 3-part
//      convention — what it does, when to use, when NOT to use + routing
//      hint. v1 is informational (warn, don't throw); Wave 5 agents fix
//      warnings as they add tools. `auditAllDescriptions()` batch-audits the
//      whole registry and is wired into CI via the unit-test suite.
//
// Not here: actual MCP server wiring. That's Wave 3 (server bootstrap), which
// will call these functions to populate its `ListToolsRequestSchema` handler.

import { zodToJsonSchema } from 'zod-to-json-schema';

import type { AnyToolDef, ToolDef } from './types.js';

// -- MCP emitter -----------------------------------------------------------

/**
 * JSON Schema (draft-07 / jsonSchema7) object — that's the dialect MCP clients
 * expect, and it matches `zod-to-json-schema`'s default target. We keep the
 * type loose (`Record<string, unknown>`) to avoid committing to a specific
 * JSON Schema typing library; MCP validates the shape on its end.
 */
export interface JsonSchemaObject {
  readonly type: 'object';
  readonly properties?: Record<string, unknown>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly [key: string]: unknown;
}

/**
 * Subset of MCP's `Tool` shape we produce. The SDK's full `Tool` type also
 * includes optional `annotations`, `icons`, `title`, `_meta`, etc.; we emit
 * only what Concierge populates in v1. Extra fields are safe to add later
 * without breaking clients (JSON-RPC result objects are loose).
 */
export interface McpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchemaObject;
  readonly outputSchema?: JsonSchemaObject;
  readonly annotations?: {
    readonly readOnlyHint?: boolean;
  };
}

/**
 * MCP `tools/list` response body.
 */
export interface McpToolList {
  readonly tools: readonly McpTool[];
}

/**
 * Convert a ToolDef's Zod input schema into a JSON-Schema object suitable for
 * the MCP `inputSchema` field. MCP requires `type === 'object'` at the top
 * level — we normalize to that shape, wrapping non-object roots in a shim
 * with no properties. In practice every Concierge tool's input IS an object
 * (that's how MCP tool arguments arrive), so the non-object path is defensive.
 */
function emitInputSchema(tool: AnyToolDef): JsonSchemaObject {
  const raw = zodToJsonSchema(tool.input, {
    // Inline definitions so the MCP client doesn't need a $ref resolver.
    $refStrategy: 'none',
    target: 'jsonSchema7',
  }) as Record<string, unknown>;

  // `zod-to-json-schema` emits `$schema`, which MCP clients tolerate but
  // don't need. Strip it so the emitted object stays focused.
  const { $schema: _discarded, ...rest } = raw;
  void _discarded;

  if (rest['type'] === 'object') {
    return rest as JsonSchemaObject;
  }

  // Defensive: non-object root. MCP arguments are always a JSON object, so
  // we wrap the schema under a synthetic `value` property.
  return {
    type: 'object',
    properties: { value: rest },
    required: ['value'],
  };
}

function emitOutputSchema(tool: AnyToolDef): JsonSchemaObject | undefined {
  const raw = zodToJsonSchema(tool.output, {
    $refStrategy: 'none',
    target: 'jsonSchema7',
  }) as Record<string, unknown>;

  const { $schema: _discarded, ...rest } = raw;
  void _discarded;

  if (rest['type'] === 'object') {
    return rest as JsonSchemaObject;
  }
  // Non-object outputs — e.g., a tool returning a raw string — aren't
  // representable in MCP's `outputSchema` (which requires type: 'object').
  // Skip emitting; the SDK treats absence as "unstructured output allowed".
  return undefined;
}

/**
 * Convert a list of ToolDefs into an MCP `tools/list` response body.
 *
 * Order is preserved: tools appear in registration order, which matches the
 * order Wave 5 agents add them. The MCP spec doesn't require any particular
 * ordering but deterministic output helps golden-file diffing in tests.
 */
export function toMcpToolList(tools: readonly AnyToolDef[]): McpToolList {
  const emitted: McpTool[] = tools.map((tool) => {
    const outputSchema = emitOutputSchema(tool);
    const base: McpTool = {
      name: tool.name,
      description: tool.description,
      inputSchema: emitInputSchema(tool),
      annotations: { readOnlyHint: tool.readonly },
      ...(outputSchema !== undefined ? { outputSchema } : {}),
    };
    return base;
  });

  return { tools: emitted };
}

// -- Description linter ----------------------------------------------------

/**
 * Outcome of linting a single description.
 *
 * `ok === true` means no warnings fired. `warnings` always present (possibly
 * empty) so callers can uniformly pipe results into a logger without null
 * checks.
 *
 * v1 is advisory — registration does not gate on `ok`. Wave 5 agents are
 * expected to resolve warnings as they land tools.
 */
export interface DescriptionLintResult {
  readonly ok: boolean;
  readonly warnings: readonly string[];
}

/**
 * Minimum description length (plan Decision #13.5). Longer than the spec's
 * 40-char floor because the 3-part pattern rarely compresses below ~80 chars
 * in practice. Terse descriptions lose tool-selection battles to claude.ai
 * connectors with richer copy (confirmed empirically — see injection spike
 * narrative in plan §13.5).
 */
const MIN_DESCRIPTION_LENGTH = 80;

/**
 * Trigger-phrase regex for the "when to use" clause. Case-insensitive; we
 * accept either "Use when ..." or a bare "Use ..." imperative (the latter
 * covers phrasings like "Use to send a message ...").
 */
const USE_WHEN_PATTERN = /\buse\s+(when|to|for|if)\b/i;

/**
 * Routing-hint regex for the "when NOT to use" clause. Matches either
 * "For <context>, prefer ..." or "Prefer ... for ..." — both common shapes
 * in the canonical samples. Not required (some tools have no competing
 * surface, e.g., `drive_upload`, `forms_forms_create`), but we warn if the
 * description mentions overlapping services without offering a routing hint.
 */
const ROUTING_HINT_PATTERN = /\b(prefer|route|use\s+(?:instead|the))\b/i;

/**
 * Imperative-verb check for the first sentence. Heuristic: starts with a
 * capital letter followed by at least one lowercase letter, ends with ".",
 * and the first word ends in "s" (3rd-person imperative like "Sends",
 * "Lists", "Creates"). This is a loose proxy — a few false negatives are
 * fine since the linter only warns.
 */
const IMPERATIVE_FIRST_WORD_PATTERN = /^([A-Z][a-z]+s)\b/;

/**
 * Lint one tool's description against Decision #13.5. Returns an informational
 * result; callers decide whether to surface the warnings.
 *
 * Checks performed:
 *   1. Length >= MIN_DESCRIPTION_LENGTH (signals non-trivial detail).
 *   2. Starts with an imperative 3rd-person verb (heuristic pattern).
 *   3. Contains a "Use when / Use to / Use for" trigger-phrase clause.
 *   4. If the description references a competing surface (claude.ai, native,
 *      connector, etc.), it should also contain a routing hint ("prefer",
 *      "route", "use instead").
 */
export function validateDescription(description: string): DescriptionLintResult {
  const warnings: string[] = [];
  const trimmed = description.trim();

  if (trimmed.length < MIN_DESCRIPTION_LENGTH) {
    warnings.push(
      `description is ${String(trimmed.length)} chars (< ${String(MIN_DESCRIPTION_LENGTH)}); expand the 3-part pattern (what / when to use / routing hint) per Decision #13.5.`,
    );
  }

  // Pull the first sentence for the imperative check. If there's no period,
  // use the whole thing.
  const firstSentence = trimmed.split(/\.(?:\s|$)/, 1)[0] ?? trimmed;
  if (!IMPERATIVE_FIRST_WORD_PATTERN.test(firstSentence)) {
    warnings.push(
      'first sentence should start with an imperative 3rd-person verb (e.g., "Sends ...", "Lists ...", "Creates ...") per Decision #13.5 part 1.',
    );
  }

  if (!USE_WHEN_PATTERN.test(trimmed)) {
    warnings.push(
      'missing "Use when ..." (or "Use to ..."/"Use for ...") trigger-phrase clause per Decision #13.5 part 2.',
    );
  }

  // If the description references claude.ai / native / connector surfaces,
  // it should also give a routing hint.
  const mentionsCompetitor = /\b(claude\.ai|native|connector|hosted)\b/i.test(trimmed);
  if (mentionsCompetitor && !ROUTING_HINT_PATTERN.test(trimmed)) {
    warnings.push(
      'mentions a competing surface but lacks a routing hint ("prefer ...", "use ... instead") per Decision #13.5 part 3.',
    );
  }

  return { ok: warnings.length === 0, warnings };
}

/**
 * Audit-result entry per tool. `tool` is the tool name for log correlation;
 * `result` carries the lint findings.
 */
export interface DescriptionAuditEntry {
  readonly tool: string;
  readonly result: DescriptionLintResult;
}

/**
 * Batch-lint every tool in the registry. Returns one entry per tool,
 * including tools that pass (`result.ok === true`), so CI can emit a
 * structured report. Tests use this to assert the registry is clean.
 */
export function auditAllDescriptions(tools: readonly AnyToolDef[]): readonly DescriptionAuditEntry[] {
  return tools.map((tool) => ({
    tool: tool.name,
    result: validateDescription(tool.description),
  }));
}

/**
 * Filter an audit report to only tools with warnings. Convenience for CI
 * output and for log emission at server startup.
 */
export function auditFailures(
  entries: readonly DescriptionAuditEntry[],
): readonly DescriptionAuditEntry[] {
  return entries.filter((entry) => !entry.result.ok);
}

// Re-export `ToolDef` type for Wave 3/5 consumers importing from this module.
export type { ToolDef };
