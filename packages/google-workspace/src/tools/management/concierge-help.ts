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

export const ConciergeHelpOutputSchema = z
  .object({
    welcome: z.string(),
    common_tasks: z.array(CommonTaskSchema),
    getting_started: z.array(z.string()),
    troubleshooting_docs: z.array(TroubleshootingDocSchema),
    related_tools: z.array(RelatedToolSchema),
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
    purpose: 'Power-user escape hatch — call any gws Discovery method not covered by a typed tool',
  },
];

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
