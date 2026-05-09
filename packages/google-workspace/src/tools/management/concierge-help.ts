// concierge_help — management tool.
//
// Guided tour of what Concierge does. Where `concierge_info` is the
// version/runtime diagnostic (strict shape, suited to bug reports), this tool
// is the user-education surface: common-task recipes, getting-started hints,
// troubleshooting doc links, related-tool pointers, and developer contact
// info. Claude picks this up when the user asks "how do I use Concierge",
// "what tools are available", "how do I get help", etc.
//
// Readonly: true. Purely data — no subprocess beyond the shared cached
// `gws --version` probe for the `version.gws` field. Safe to invoke
// repeatedly.
//
// Versions are populated via the same mechanism used by `concierge_info`:
// tsup `define` bakes `__CONCIERGE_VENDOR_VERSION__` + `__CONCIERGE_CORE_VERSION__`
// at build time; dev/test runs fall back to reading package.json relative to
// this module.
//
// Description: conforms to Decision #13.5 (what / when / routing hint).

import { z } from 'zod/v3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

import { getGwsVersion } from '../../gws/runner.js';
import type { ToolContext, ToolDef, ToolResult } from '../types.js';

// --------------------------------------------------------------------------
// Schemas
// --------------------------------------------------------------------------

export const ConciergeHelpInputSchema = z.object({}).strict();

export type ConciergeHelpInput = z.infer<typeof ConciergeHelpInputSchema>;

const CommonTaskSchema = z
  .object({
    want: z.string(),
    ask_claude: z.string(),
    uses_tool: z.string(),
  })
  .strict();

const TroubleshootingDocSchema = z
  .object({
    topic: z.string(),
    url: z.string(),
  })
  .strict();

const RelatedToolSchema = z
  .object({
    tool: z.string(),
    purpose: z.string(),
  })
  .strict();

const SupportSchema = z
  .object({
    developer: z.string(),
    note: z.string(),
  })
  .strict();

const VersionSchema = z
  .object({
    vendor: z.string(),
    core: z.string(),
    gws: z.string(),
    build_time: z.string(),
    build_id: z.string(),
  })
  .strict();

const GwsExecuteExampleSchema = z
  .object({
    want: z.string(),
    service: z.string(),
    resource: z.string(),
    method: z.string(),
    readonly: z.boolean(),
    params_example: z.string(),
  })
  .strict();

const GwsExecuteReferenceSchema = z
  .object({
    summary: z.string(),
    input_shape: z.object({
      service: z.string(),
      resource: z.string(),
      method: z.string(),
      params: z.string(),
      body: z.string(),
      readonly: z.string(),
      account: z.string(),
    }).strict(),
    resource_path_rules: z.array(z.string()),
    examples: z.array(GwsExecuteExampleSchema),
    notes: z.array(z.string()),
  })
  .strict();

export const ConciergeHelpOutputSchema = z
  .object({
    welcome: z.string(),
    common_tasks: z.array(CommonTaskSchema),
    getting_started: z.array(z.string()),
    troubleshooting_docs: z.array(TroubleshootingDocSchema),
    related_tools: z.array(RelatedToolSchema),
    gws_execute_reference: GwsExecuteReferenceSchema,
    support: SupportSchema,
    version: VersionSchema,
  })
  .strict();

export type ConciergeHelpOutput = z.infer<typeof ConciergeHelpOutputSchema>;

// --------------------------------------------------------------------------
// Version resolution — mirror concierge_info's dev/bundled split.
// --------------------------------------------------------------------------

function readVendorVersion(): string {
  if (typeof __CONCIERGE_VENDOR_VERSION__ !== 'undefined') {
    return __CONCIERGE_VENDOR_VERSION__;
  }
  return readSiblingPackageJsonVersion('../../../package.json');
}

function readCoreVersion(): string {
  if (typeof __CONCIERGE_CORE_VERSION__ !== 'undefined') {
    return __CONCIERGE_CORE_VERSION__;
  }
  return readSiblingPackageJsonVersion('../../../../core/package.json');
}

function readSiblingPackageJsonVersion(relPath: string): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const resolved = path.resolve(here, relPath);
    const raw = readFileSync(resolved, 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function readBuildTime(): string {
  if (typeof __CONCIERGE_BUILD_TIME__ !== 'undefined') {
    return __CONCIERGE_BUILD_TIME__;
  }
  return 'dev-unbuilt';
}

function readBuildId(): string {
  if (typeof __CONCIERGE_BUILD_ID__ !== 'undefined') {
    return __CONCIERGE_BUILD_ID__;
  }
  return 'devbuild';
}

// --------------------------------------------------------------------------
// Static content
// --------------------------------------------------------------------------

const WELCOME =
  'Concierge brings Google Workspace into Claude Desktop via local MCP. ' +
  'Strictly local — your data never leaves your Mac.';

const COMMON_TASKS: ReadonlyArray<z.infer<typeof CommonTaskSchema>> = [
  {
    want: 'Send an email',
    ask_claude: 'Send an email to alice@example.com saying X',
    uses_tool: 'gmail_send',
  },
  {
    want: 'Reply to a message',
    ask_claude: 'Reply to the latest message from Alice saying X',
    uses_tool: 'gmail_reply',
  },
  {
    want: 'Triage your inbox',
    ask_claude: "What's in my inbox right now?",
    uses_tool: 'gmail_triage',
  },
  {
    want: 'Send a Chat message',
    ask_claude: 'Send a message to the #team space saying X',
    uses_tool: 'chat_send',
  },
  {
    want: 'List Drive files',
    ask_claude: 'What files are in my Drive?',
    uses_tool: 'drive_files_list',
  },
  {
    want: 'Upload a file to Drive',
    ask_claude: 'Upload report.pdf to my Drive',
    uses_tool: 'drive_upload',
  },
  {
    want: 'Share a Drive file',
    ask_claude: 'Share this Drive file with alice@example.com',
    uses_tool: 'drive_permissions_create',
  },
  {
    want: 'Create a spreadsheet',
    ask_claude: 'Create a new Google Sheet called Q2 Budget',
    uses_tool: 'sheets_spreadsheets_create',
  },
  {
    want: 'Create a Google Form',
    ask_claude: 'Create a Google Form titled Customer Intake',
    uses_tool: 'forms_forms_create',
  },
  {
    want: 'Run a morning standup report',
    ask_claude: 'Give me my standup report',
    uses_tool: 'workflow_standup_report',
  },
];

const GETTING_STARTED: readonly string[] = [
  'Ask me natural-language questions — Concierge picks the right tool automatically.',
  "First time using a service? Claude opens a browser to get Google's consent for just that service. No setup per tool.",
  "For read-focused lookups (search Drive, summarize email), claude.ai's hosted Gmail/Drive/Calendar connectors are often the better pick — Concierge shines for writes and for services the hosted connectors don't cover.",
  'Destructive actions (remove_account, factory_reset) require typing an exact phrase — intentional safety gate.',
  'Use concierge_info for version/runtime details, list_accounts to see connected Google accounts, set_read_only to lock your account into read-only mode.',
];

const DOCS_BASE = 'https://github.com/Jstottlemyer/Concierge/blob/main';

const TROUBLESHOOTING_DOCS: ReadonlyArray<z.infer<typeof TroubleshootingDocSchema>> = [
  {
    topic: 'First-time setup',
    url: `${DOCS_BASE}/docs/setup/user-onboarding.md`,
  },
  {
    topic: 'Enable Google APIs for your project',
    url: `${DOCS_BASE}/docs/setup/user-onboarding.md#step-45--enable-the-google-workspace-apis-for-your-project`,
  },
  {
    topic: 'Common errors reference',
    url: `${DOCS_BASE}/docs/troubleshooting.md`,
  },
  {
    topic: 'Release procedure (for developers)',
    url: `${DOCS_BASE}/docs/release/release-procedure.md`,
  },
  {
    topic: 'What Concierge does + architecture',
    url: `${DOCS_BASE}/docs/vendors/google-workspace/spec.md`,
  },
];

const RELATED_TOOLS: ReadonlyArray<z.infer<typeof RelatedToolSchema>> = [
  {
    tool: 'concierge_info',
    purpose: 'Version + runtime diagnostics',
  },
  {
    tool: 'list_accounts',
    purpose: 'See connected Google accounts and granted scope bundles',
  },
  {
    tool: 'set_read_only',
    purpose: 'Toggle Read-Only mode for an account',
  },
  {
    tool: 'gws_execute',
    purpose:
      'Power-user escape hatch — call any gws Discovery method not covered by a typed tool. ' +
      'See gws_execute_reference in this output for the input shape, dotted resource paths, and recipes.',
  },
];

// --------------------------------------------------------------------------
// gws_execute reference — input shape + dotted-path conventions + recipes.
// --------------------------------------------------------------------------
//
// Surfaces the passthrough's input contract so a future Claude session reading
// `concierge_help` knows how to reach 4-level Discovery resources (Gmail
// users.messages / users.threads / users.labels / users.drafts, plus
// users.messages.attachments) without trial-and-error. Mirrors the regex in
// `validators.validateResourcePath` and the argv-construction logic in
// `gws_execute.buildPassthroughArgv`.

const GWS_EXECUTE_REFERENCE: z.infer<typeof GwsExecuteReferenceSchema> = {
  summary:
    'gws_execute is the generic Discovery passthrough. Use it when no typed tool covers your need. ' +
    'Resource accepts Discovery-style dotted paths so nested resources (e.g., gmail.users.messages) ' +
    'are reachable. Each call requires a self-asserted `readonly` flag for Read-Only-mode enforcement.',
  input_shape: {
    service:
      'Lowercase service id (e.g., "drive", "gmail", "sheets", "docs", "forms", "admin-reports", "chat").',
    resource:
      'Discovery resource path. Single segment for top-level resources ("files", "spreadsheets") or ' +
      'dot-separated for nested ones ("users.messages", "users.threads", "users.labels", ' +
      '"users.drafts", "users.messages.attachments"). Lowercase first character per segment, ' +
      'up to 8 segments.',
    method:
      'Discovery method name (e.g., "list", "get", "create", "trash", "untrash", "modify", ' +
      '"batchModify", "batchDelete", "send"). Lowercase first character.',
    params:
      'Optional JSON object of query/path params (camelCase keys per the Discovery doc). ' +
      'For Gmail user-scoped calls, always include "userId": "me".',
    body:
      'Optional JSON object for POST/PATCH/PUT request bodies (e.g., label modifications, draft content).',
    readonly:
      'Required boolean. Caller asserts whether this call mutates state. Read-Only-mode middleware ' +
      'cross-checks against the account flag and rejects writes when the account is in Read-Only mode.',
    account:
      'Optional authenticated email. Omit to use the gws default account.',
  },
  resource_path_rules: [
    'Each dot-separated segment matches /^[a-z][a-zA-Z0-9_-]{0,48}$/ — same rules as service/method.',
    'Path is split on "." and emitted as separate argv tokens, so "users.messages" → ' +
      '"gws gmail users messages <method>".',
    'Maximum 8 segments. Empty/leading/trailing dots and uppercase first chars are rejected.',
    'Single-segment paths still work unchanged (e.g., resource:"files" for Drive).',
  ],
  examples: [
    {
      want: 'List Gmail messages matching a query',
      service: 'gmail',
      resource: 'users.messages',
      method: 'list',
      readonly: true,
      params_example: '{"userId":"me","q":"is:unread newer_than:1d","maxResults":50}',
    },
    {
      want: 'Read a single Gmail message (full body, base64url)',
      service: 'gmail',
      resource: 'users.messages',
      method: 'get',
      readonly: true,
      params_example: '{"userId":"me","id":"<MESSAGE_ID>","format":"full"}',
    },
    {
      want: 'Move a Gmail message to Trash (recoverable, preferred over delete)',
      service: 'gmail',
      resource: 'users.messages',
      method: 'trash',
      readonly: false,
      params_example: '{"userId":"me","id":"<MESSAGE_ID>"}',
    },
    {
      want: 'Restore a Gmail message from Trash',
      service: 'gmail',
      resource: 'users.messages',
      method: 'untrash',
      readonly: false,
      params_example: '{"userId":"me","id":"<MESSAGE_ID>"}',
    },
    {
      want: 'Add or remove labels on a Gmail message',
      service: 'gmail',
      resource: 'users.messages',
      method: 'modify',
      readonly: false,
      params_example:
        '{"userId":"me","id":"<MESSAGE_ID>"} + body: {"addLabelIds":["Label_42"],"removeLabelIds":["INBOX"]}',
    },
    {
      want: 'Bulk-modify many messages in one call (up to 1000 ids)',
      service: 'gmail',
      resource: 'users.messages',
      method: 'batchModify',
      readonly: false,
      params_example:
        '{"userId":"me"} + body: {"ids":["id1","id2"],"addLabelIds":["TRASH"]}',
    },
    {
      want: 'List Gmail threads',
      service: 'gmail',
      resource: 'users.threads',
      method: 'list',
      readonly: true,
      params_example: '{"userId":"me","q":"from:alice@example.com"}',
    },
    {
      want: 'Move a whole thread to Trash',
      service: 'gmail',
      resource: 'users.threads',
      method: 'trash',
      readonly: false,
      params_example: '{"userId":"me","id":"<THREAD_ID>"}',
    },
    {
      want: 'List Gmail labels',
      service: 'gmail',
      resource: 'users.labels',
      method: 'list',
      readonly: true,
      params_example: '{"userId":"me"}',
    },
    {
      want: 'Create a Gmail label',
      service: 'gmail',
      resource: 'users.labels',
      method: 'create',
      readonly: false,
      params_example: '{"userId":"me"} + body: {"name":"Receipts","labelListVisibility":"labelShow"}',
    },
    {
      want: 'List Gmail drafts',
      service: 'gmail',
      resource: 'users.drafts',
      method: 'list',
      readonly: true,
      params_example: '{"userId":"me"}',
    },
    {
      want: 'Download a message attachment',
      service: 'gmail',
      resource: 'users.messages.attachments',
      method: 'get',
      readonly: true,
      params_example: '{"userId":"me","messageId":"<MSG>","id":"<ATTACHMENT_ID>"}',
    },
    {
      want: 'Drive: list files (single-segment resource — no change)',
      service: 'drive',
      resource: 'files',
      method: 'list',
      readonly: true,
      params_example: '{"pageSize":25,"q":"mimeType=\'application/pdf\'"}',
    },
  ],
  notes: [
    'Prefer typed tools (gmail_triage, gmail_send, gmail_reply, drive_files_list, etc.) when one exists — they handle pagination, redaction, and ergonomics automatically.',
    'Trash before delete: prefer users.messages.trash / users.threads.trash. The raw `delete` method is permanent and irreversible.',
    'Always include "userId":"me" in params for Gmail and Calendar user-scoped calls — gws does not infer it.',
    'Set `readonly: false` for any method that mutates state (trash, untrash, modify, create, update, send, batchDelete, batchModify). Set `readonly: true` only for pure reads (list, get).',
    'Read-Only mode: if the account is in Read-Only mode and you call gws_execute with `readonly: false`, the middleware rejects the call before the subprocess runs.',
    'Source of truth for resource/method names is the Google Discovery doc. The gws CLI mirrors that hierarchy 1:1.',
  ],
};

const SUPPORT: z.infer<typeof SupportSchema> = {
  developer: 'Justin Stottlemyer',
  note:
    'Public support channels (email, GitHub Issues) are coming as Concierge matures. ' +
    'If you know Justin directly, reach out through existing personal channels.',
};

// --------------------------------------------------------------------------
// Tool definition
// --------------------------------------------------------------------------

export const CONCIERGE_HELP_DESCRIPTION =
  'Returns a guided tour of what Concierge can do — common task → tool mappings, getting-started ' +
  'hints, troubleshooting docs, related tools, and developer contact info. Use when the user asks ' +
  'how to use Concierge, what tools are available, how to get help, or how to contact the ' +
  'developer. For version diagnostics only, prefer concierge_info.';

async function invoke(
  _args: ConciergeHelpInput,
  _ctx: ToolContext,
): Promise<ToolResult<ConciergeHelpOutput>> {
  void _args;
  void _ctx;

  const vendor = readVendorVersion();
  const core = readCoreVersion();
  const buildTime = readBuildTime();
  const buildId = readBuildId();

  let gws = 'unknown';
  try {
    gws = await getGwsVersion();
  } catch {
    // Non-fatal — `concierge_help` should never fail the user just because
    // the `gws` binary is unavailable. The diagnostic tool is `concierge_info`;
    // here we degrade gracefully.
  }

  const output: ConciergeHelpOutput = {
    welcome: WELCOME,
    common_tasks: COMMON_TASKS.map((t) => ({ ...t })),
    getting_started: [...GETTING_STARTED],
    troubleshooting_docs: TROUBLESHOOTING_DOCS.map((d) => ({ ...d })),
    related_tools: RELATED_TOOLS.map((r) => ({ ...r })),
    gws_execute_reference: {
      summary: GWS_EXECUTE_REFERENCE.summary,
      input_shape: { ...GWS_EXECUTE_REFERENCE.input_shape },
      resource_path_rules: [...GWS_EXECUTE_REFERENCE.resource_path_rules],
      examples: GWS_EXECUTE_REFERENCE.examples.map((e) => ({ ...e })),
      notes: [...GWS_EXECUTE_REFERENCE.notes],
    },
    support: { ...SUPPORT },
    version: { vendor, core, gws, build_time: buildTime, build_id: buildId },
  };

  return { ok: true, data: output };
}

export const conciergeHelp: ToolDef<ConciergeHelpInput, ConciergeHelpOutput> = {
  name: 'concierge_help',
  description: CONCIERGE_HELP_DESCRIPTION,
  service: 'management',
  readonly: true,
  input: ConciergeHelpInputSchema,
  output: ConciergeHelpOutputSchema,
  invoke,
};
