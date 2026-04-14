// Vendor-helper tool barrel + registration entry point (T11).
//
// Wave 5b lands 22 vendor helpers that wrap `gws <service> +<helper>`. Each
// lives in its own module under `src/tools/vendor/` for readability; this
// file exports the canonical list and a single `registerVendorTools()` that
// the server bootstrap (Wave 3 dispatcher wiring + T14 index) calls once at
// startup.
//
// The helpers are explicitly listed (not glob-imported) so dropping a tool is
// a compile error, not a silent omission from the registry.

import { registerTool } from '../registry.js';
import type { AnyToolDef } from '../types.js';

import { chatSend } from './chat-send.js';
import { docsWrite } from './docs-write.js';
import { driveUpload } from './drive-upload.js';
import { eventsRenew } from './events-renew.js';
import { eventsSubscribe } from './events-subscribe.js';
import { gmailForward } from './gmail-forward.js';
import { gmailReply } from './gmail-reply.js';
import { gmailReplyAll } from './gmail-reply-all.js';
import { gmailSend } from './gmail-send.js';
import { gmailTriage } from './gmail-triage.js';
import { gmailWatch } from './gmail-watch.js';
import { modelarmorCreateTemplate } from './modelarmor-create-template.js';
import { modelarmorSanitizePrompt } from './modelarmor-sanitize-prompt.js';
import { modelarmorSanitizeResponse } from './modelarmor-sanitize-response.js';
import { scriptPush } from './script-push.js';
import { sheetsAppend } from './sheets-append.js';
import { sheetsRead } from './sheets-read.js';
import { workflowEmailToTask } from './workflow-email-to-task.js';
import { workflowFileAnnounce } from './workflow-file-announce.js';
import { workflowMeetingPrep } from './workflow-meeting-prep.js';
import { workflowStandupReport } from './workflow-standup-report.js';
import { workflowWeeklyDigest } from './workflow-weekly-digest.js';

/**
 * Ordered list of all 22 vendor-helper tools. Order is stable and used as
 * both the registration order and the expected order in
 * `tools/list` snapshots. Alphabetical by module name so diffs stay clean
 * when tools are added.
 */
export const VENDOR_TOOLS: readonly AnyToolDef[] = [
  chatSend,
  docsWrite,
  driveUpload,
  eventsRenew,
  eventsSubscribe,
  gmailForward,
  gmailReply,
  gmailReplyAll,
  gmailSend,
  gmailTriage,
  gmailWatch,
  modelarmorCreateTemplate,
  modelarmorSanitizePrompt,
  modelarmorSanitizeResponse,
  scriptPush,
  sheetsAppend,
  sheetsRead,
  workflowEmailToTask,
  workflowFileAnnounce,
  workflowMeetingPrep,
  workflowStandupReport,
  workflowWeeklyDigest,
] as unknown as readonly AnyToolDef[];

/**
 * Register every vendor-helper tool with the shared registry. Idempotent
 * within a single process run because `registerTool` throws on duplicates;
 * tests call `__resetRegistryForTests()` in `beforeEach` before invoking.
 *
 * We list the tools explicitly rather than iterating VENDOR_TOOLS because
 * `registerTool` is generic on `<Input, Output>` — iterating the loosely
 * typed array collapses the generics to `never` and loses the call-site
 * type-check that each tool's input/output types are consistent.
 */
export function registerVendorTools(): void {
  registerTool(chatSend);
  registerTool(docsWrite);
  registerTool(driveUpload);
  registerTool(eventsRenew);
  registerTool(eventsSubscribe);
  registerTool(gmailForward);
  registerTool(gmailReply);
  registerTool(gmailReplyAll);
  registerTool(gmailSend);
  registerTool(gmailTriage);
  registerTool(gmailWatch);
  registerTool(modelarmorCreateTemplate);
  registerTool(modelarmorSanitizePrompt);
  registerTool(modelarmorSanitizeResponse);
  registerTool(scriptPush);
  registerTool(sheetsAppend);
  registerTool(sheetsRead);
  registerTool(workflowEmailToTask);
  registerTool(workflowFileAnnounce);
  registerTool(workflowMeetingPrep);
  registerTool(workflowStandupReport);
  registerTool(workflowWeeklyDigest);
}

// Re-export individual tools for targeted unit tests.
export {
  chatSend,
  docsWrite,
  driveUpload,
  eventsRenew,
  eventsSubscribe,
  gmailForward,
  gmailReply,
  gmailReplyAll,
  gmailSend,
  gmailTriage,
  gmailWatch,
  modelarmorCreateTemplate,
  modelarmorSanitizePrompt,
  modelarmorSanitizeResponse,
  scriptPush,
  sheetsAppend,
  sheetsRead,
  workflowEmailToTask,
  workflowFileAnnounce,
  workflowMeetingPrep,
  workflowStandupReport,
  workflowWeeklyDigest,
};
