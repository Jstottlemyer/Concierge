// Fixture corpus index test.
//
// Asserts that the T7.5 fixture bundles — `gws --help` captures, sample
// response JSON shapes, and the log-scan token probe — are present, non-empty,
// and well-formed. Downstream consumers (T11 schema derivation, T12 shim TDD,
// T28 log-scan known-token seed) rely on this corpus; a missing or empty
// fixture file would silently weaken those tests.
//
// Spec ref: docs/vendors/google-workspace/plan.md Wave 4 / T7.5.

import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { redactString } from '../../src/log/redact.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const HELP_DIR = join(HERE, 'gws-help');
const RESPONSE_DIR = join(HERE, 'gws-responses');
const LOG_SCAN_DIR = join(HERE, 'log-scan');

/**
 * Every `gws --help` capture that must exist. Order mirrors the INDEX.md
 * grouping — vendor helpers (`+...`) first per service, then Discovery-doc
 * method paths.
 */
const HELP_FILES: readonly string[] = [
  'gws_root.txt',

  // auth
  'auth.txt',
  'auth_login.txt',
  'auth_setup.txt',

  // drive
  'drive.txt',
  'drive_upload.txt',
  'drive_files_list.txt',
  'drive_files_get.txt',
  'drive_permissions_create.txt',

  // gmail
  'gmail.txt',
  'gmail_send.txt',
  'gmail_reply.txt',
  'gmail_reply_all.txt',
  'gmail_forward.txt',
  'gmail_triage.txt',
  'gmail_watch.txt',

  // sheets
  'sheets.txt',
  'sheets_append.txt',
  'sheets_read.txt',
  'sheets_spreadsheets_create.txt',

  // docs
  'docs.txt',
  'docs_write.txt',
  'docs_documents_get.txt',
  'docs_documents_create.txt',

  // chat
  'chat.txt',
  'chat_send.txt',
  'chat_spaces_list.txt',

  // calendar (reference only)
  'calendar.txt',

  // script
  'script.txt',
  'script_push.txt',

  // workflow
  'workflow.txt',
  'workflow_standup_report.txt',
  'workflow_meeting_prep.txt',
  'workflow_email_to_task.txt',
  'workflow_weekly_digest.txt',
  'workflow_file_announce.txt',

  // events
  'events.txt',
  'events_subscribe.txt',
  'events_renew.txt',

  // modelarmor
  'modelarmor.txt',
  'modelarmor_sanitize_prompt.txt',
  'modelarmor_sanitize_response.txt',
  'modelarmor_create_template.txt',

  // meet
  'meet_spaces_create.txt',

  // forms
  'forms_forms_create.txt',
  'forms_responses_list.txt',

  // admin-reports
  'admin_reports_activities_list.txt',
  'admin_reports_user_usage_report_get.txt',
];

/** JSON response fixtures, one per shim-target tool from T12. */
const RESPONSE_FILES: readonly string[] = [
  'drive.files.list.json',
  'drive.files.get.json',
  'drive.permissions.create.json',
  'docs.documents.get.json',
  'docs.documents.create.json',
  'sheets.spreadsheets.create.json',
  'chat.spaces.list.json',
  'meet.spaces.create.json',
  'forms.forms.create.json',
  'forms.responses.list.json',
  'admin.reports.activities.list.json',
  'admin.reports.usageReports.get.json',
];

describe('fixture corpus — gws --help captures', () => {
  for (const file of HELP_FILES) {
    it(`${file} exists and is non-empty`, () => {
      const full = join(HELP_DIR, file);
      const stat = statSync(full);
      expect(stat.size).toBeGreaterThan(0);
      const body = readFileSync(full, 'utf8');
      // Every gws --help output starts with a description/usage line, not a
      // top-level JSON error envelope. Guard against accidentally committing
      // error captures (e.g., from a wrong command path).
      expect(body).not.toMatch(/^\{\s*"error"/);
      expect(body).not.toMatch(/unrecognized subcommand/);
    });
  }

  it('INDEX.md exists', () => {
    const full = join(HELP_DIR, 'INDEX.md');
    const stat = statSync(full);
    expect(stat.size).toBeGreaterThan(0);
  });
});

describe('fixture corpus — sample response shapes', () => {
  for (const file of RESPONSE_FILES) {
    it(`${file} is valid JSON and non-empty`, () => {
      const full = join(RESPONSE_DIR, file);
      const body = readFileSync(full, 'utf8');
      expect(body.length).toBeGreaterThan(0);
      // Round-trip through JSON.parse — throws if the fixture is malformed.
      const parsed = JSON.parse(body) as unknown;
      expect(parsed).toBeTypeOf('object');
      expect(parsed).not.toBeNull();
    });
  }
});

describe('fixture corpus — log-scan positive tokens', () => {
  const file = join(LOG_SCAN_DIR, 'positive-tokens.txt');

  it('contains at least 7 probe lines', () => {
    const body = readFileSync(file, 'utf8');
    const lines = body.split('\n').filter((line) => line.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(7);
  });

  it('every probe line is fully scrubbed by redactString', () => {
    const body = readFileSync(file, 'utf8');
    const lines = body.split('\n').filter((line) => line.length > 0);

    for (const line of lines) {
      const scrubbed = redactString(line);
      // After redaction, none of the committed token prefixes may survive.
      // If a line slips through, either the fixture is malformed or the
      // redactor has a regression — both are failures.
      expect(scrubbed, `probe slipped past redactor: ${line}`).not.toContain('ya29.');
      expect(scrubbed, `probe slipped past redactor: ${line}`).not.toMatch(/\b1\/\//);
      expect(scrubbed, `probe slipped past redactor: ${line}`).not.toContain('GOCSPX-');
      expect(scrubbed, `probe slipped past redactor: ${line}`).not.toMatch(/\beyJ[A-Za-z0-9_-]+\./);
      expect(scrubbed, `probe slipped past redactor: ${line}`).not.toMatch(/client_secret\s*[=:]/);
      expect(scrubbed, `probe slipped past redactor: ${line}`).not.toMatch(/refresh_token\s*[=:]/);
      expect(scrubbed, `probe slipped past redactor: ${line}`).not.toMatch(/access_token\s*[=:]/);
    }
  });
});
