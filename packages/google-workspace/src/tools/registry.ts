// Tool registry for Concierge.
//
// Wave 2 — T4. The registry is a mutable array during startup (Wave 5 agents
// call `registerTool` as they import each tool module); freeze semantics kick
// in once `finalizeRegistry()` runs at server bootstrap. After freeze, any
// further `registerTool` call throws — preventing accidental late
// registrations that would escape the MCP `tools/list` snapshot the client
// cached at connect time.
//
// Design notes:
// - Duplicate-name registration throws immediately. Names are the MCP
//   addressing key, so a silent overwrite would be a security footgun.
// - `TOOLS_BY_NAME` is a plain object (not Map) to keep the public type
//   simple; it's rebuilt on each register so readers always see a consistent
//   index against the array's current length.
// - No runtime description-lint here — that lives in `mcp-schema.ts` so tests
//   can run the audit independently. Registration does validate the tool name
//   and service tag to catch obvious typos at import time.

import { ConciergeError } from '@concierge/core/errors';

import type { AnyToolDef, ToolDef, ToolServiceTag } from './types.js';

/**
 * Valid `service` values. Kept in sync with the `ToolServiceTag` union in
 * `types.ts`. A runtime copy is necessary for `registerTool`'s tag check —
 * TypeScript unions don't survive to runtime.
 */
const VALID_SERVICE_TAGS: ReadonlySet<ToolServiceTag> = new Set<ToolServiceTag>([
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
]);

/**
 * MCP tool names must be non-empty and restricted to characters the protocol
 * safely round-trips. We're stricter than the spec (only lowercase letters,
 * digits, and underscores) to enforce Concierge' naming conventions from plan
 * Decision #2 (`gmail_send`, `drive_files_list`, `admin_reports_activities_list`).
 */
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

// Module-private mutable state — isolated here so it can be reset in tests
// via `__resetRegistryForTests()`.
let tools: AnyToolDef[] = [];
let byName: Record<string, AnyToolDef> = Object.create(null) as Record<string, AnyToolDef>;
let frozen = false;

/**
 * Live view of all registered tools. Callers must treat as read-only; the
 * array is frozen after `finalizeRegistry()` and mutating it before freeze
 * would bypass duplicate-name and frozen-state checks.
 */
export function getAllTools(): readonly AnyToolDef[] {
  return tools;
}

/**
 * Live map from tool name to definition. Returned by reference so callers can
 * cheaply look up names; do not mutate.
 */
export function getToolsByName(): Readonly<Record<string, AnyToolDef>> {
  return byName;
}

/**
 * Look up a tool by its canonical name. Returns `undefined` for unknown
 * names — callers decide whether that's a 404-equivalent or a validation
 * error (usually the MCP dispatcher in Wave 3 maps it to `validation_error`).
 */
export function getToolByName(name: string): AnyToolDef | undefined {
  // Object.create(null) means no prototype, so `in` and direct property access
  // are both safe against __proto__ pollution.
  return Object.prototype.hasOwnProperty.call(byName, name) ? byName[name] : undefined;
}

/**
 * Register a tool. Call once per tool module at import time; Wave 5 agents
 * follow this pattern as they land T11/T12/T13/T14.
 *
 * Validation:
 *   - Name matches `TOOL_NAME_PATTERN`.
 *   - Name is not already registered.
 *   - Service tag is a valid `ToolServiceTag`.
 *   - Registry is not yet frozen.
 *
 * Throws `ConciergeError` with a `registry_*` code on any violation. These
 * are developer-time errors (wrong tool definition), not runtime user errors,
 * so a thrown exception is the right signal.
 */
export function registerTool<Input, Output>(def: ToolDef<Input, Output>): void {
  if (frozen) {
    throw new ConciergeError(
      'registry_frozen',
      `Cannot register tool "${def.name}" — registry is frozen. Register all tools before server bootstrap.`,
    );
  }

  if (!TOOL_NAME_PATTERN.test(def.name)) {
    throw new ConciergeError(
      'registry_invalid_name',
      `Tool name "${def.name}" does not match ${String(TOOL_NAME_PATTERN)} — use lowercase snake_case.`,
    );
  }

  if (Object.prototype.hasOwnProperty.call(byName, def.name)) {
    throw new ConciergeError(
      'registry_duplicate_name',
      `Tool "${def.name}" is already registered. Tool names must be unique.`,
    );
  }

  if (!VALID_SERVICE_TAGS.has(def.service)) {
    throw new ConciergeError(
      'registry_invalid_service',
      `Tool "${def.name}" has invalid service tag "${String(def.service)}".`,
    );
  }

  // Rebuild index on every insert; O(n) across registration is fine for ~42
  // tools and keeps the read-only snapshot semantics simple. The cast to
  // AnyToolDef is sound: the concrete ToolDef<I,O> is stricter than AnyToolDef
  // everywhere except the invoke input's contravariance, and the registry's
  // consumers always run the input through the Zod schema before invoke.
  const erased = def as unknown as AnyToolDef;
  tools = [...tools, erased];
  byName = { ...byName, [def.name]: erased };
}

/**
 * Freeze the registry. Call once at server bootstrap after all tool modules
 * have registered. After freeze, `registerTool` throws and the arrays handed
 * out by `getAllTools()`/`getToolsByName()` are themselves frozen so stray
 * mutations fail loudly in dev.
 */
export function finalizeRegistry(): void {
  if (frozen) return;
  tools = Object.freeze([...tools]) as AnyToolDef[];
  byName = Object.freeze({ ...byName });
  frozen = true;
}

/**
 * Whether the registry is currently frozen. Exposed for diagnostics and for
 * the MCP server bootstrap to assert state before emitting `tools/list`.
 */
export function isRegistryFrozen(): boolean {
  return frozen;
}

/**
 * Test-only: reset the registry to empty and unfrozen. Must not be called in
 * production code paths. Unit tests use this to isolate registration
 * scenarios; see `tests/tools/registry.test.ts`.
 */
export function __resetRegistryForTests(): void {
  tools = [];
  byName = Object.create(null) as Record<string, AnyToolDef>;
  frozen = false;
}

/**
 * Replace every registered tool with the result of `transform(tool)`.
 *
 * Used by middleware (T17 Read-Only enforcement) to wrap each tool's invoke
 * function. Must be called before `finalizeRegistry()` — once frozen, the
 * registry cannot be mutated.
 *
 * Intentionally low-level: we re-point the module-private `tools` array and
 * `byName` index at the transformed defs. Names are preserved (the transform
 * is responsible for not renaming), so the `byName` map stays in sync by
 * name-keyed reconstruction.
 *
 * Transform returning the same reference is a no-op. This is the idempotency
 * hook middleware relies on — wrapping stamps a marker on the returned def so
 * a second call short-circuits.
 */
export function replaceAllTools(transform: (def: AnyToolDef) => AnyToolDef): void {
  if (frozen) {
    throw new ConciergeError(
      'registry_frozen',
      'Cannot replace tools — registry is frozen. Apply middleware before server bootstrap.',
    );
  }
  const next: AnyToolDef[] = tools.map((t) => transform(t));
  const nextByName: Record<string, AnyToolDef> = Object.create(null) as Record<string, AnyToolDef>;
  for (const t of next) {
    nextByName[t.name] = t;
  }
  tools = next;
  byName = nextByName;
}
