# gws --help Fixture Corpus

Captured from `gws 0.22.5` (Homebrew). Source of truth for T11 vendor-helper schema
derivation + T12 shim TDD. Regenerate by re-running the capture block in
`docs/vendors/google-workspace/plan.md` (Wave 4 / T7.5).

Files are raw stdout+stderr from `gws <cmd> --help`. No real user data: the CLI's
help output does not embed usernames or paths, and the corpus was spot-checked
after capture.

## Top-level

| Command | File |
| --- | --- |
| `gws --help` | `gws_root.txt` |

## auth

| Command | File |
| --- | --- |
| `gws auth --help` | `auth.txt` |
| `gws auth login --help` | `auth_login.txt` |
| `gws auth setup --help` | `auth_setup.txt` |

## drive (vendor helpers + shim targets)

| Command | File |
| --- | --- |
| `gws drive --help` | `drive.txt` |
| `gws drive +upload --help` | `drive_upload.txt` |
| `gws drive files list --help` | `drive_files_list.txt` |
| `gws drive files get --help` | `drive_files_get.txt` |
| `gws drive permissions create --help` | `drive_permissions_create.txt` |

## gmail (helpers only; shim targets TBD)

| Command | File |
| --- | --- |
| `gws gmail --help` | `gmail.txt` |
| `gws gmail +send --help` | `gmail_send.txt` |
| `gws gmail +reply --help` | `gmail_reply.txt` |
| `gws gmail +reply-all --help` | `gmail_reply_all.txt` |
| `gws gmail +forward --help` | `gmail_forward.txt` |
| `gws gmail +triage --help` | `gmail_triage.txt` |
| `gws gmail +watch --help` | `gmail_watch.txt` |

## sheets

| Command | File |
| --- | --- |
| `gws sheets --help` | `sheets.txt` |
| `gws sheets +append --help` | `sheets_append.txt` |
| `gws sheets +read --help` | `sheets_read.txt` |
| `gws sheets spreadsheets create --help` | `sheets_spreadsheets_create.txt` |

## docs

| Command | File |
| --- | --- |
| `gws docs --help` | `docs.txt` |
| `gws docs +write --help` | `docs_write.txt` |
| `gws docs documents get --help` | `docs_documents_get.txt` |
| `gws docs documents create --help` | `docs_documents_create.txt` |

## chat

| Command | File |
| --- | --- |
| `gws chat --help` | `chat.txt` |
| `gws chat +send --help` | `chat_send.txt` |
| `gws chat spaces list --help` | `chat_spaces_list.txt` |

## calendar (reference only, no Concierge helpers)

| Command | File |
| --- | --- |
| `gws calendar --help` | `calendar.txt` |

## script

| Command | File |
| --- | --- |
| `gws script --help` | `script.txt` |
| `gws script +push --help` | `script_push.txt` |

## workflow

| Command | File |
| --- | --- |
| `gws workflow --help` | `workflow.txt` |
| `gws workflow +standup-report --help` | `workflow_standup_report.txt` |
| `gws workflow +meeting-prep --help` | `workflow_meeting_prep.txt` |
| `gws workflow +email-to-task --help` | `workflow_email_to_task.txt` |
| `gws workflow +weekly-digest --help` | `workflow_weekly_digest.txt` |
| `gws workflow +file-announce --help` | `workflow_file_announce.txt` |

## events

| Command | File |
| --- | --- |
| `gws events --help` | `events.txt` |
| `gws events +subscribe --help` | `events_subscribe.txt` |
| `gws events +renew --help` | `events_renew.txt` |

## modelarmor

| Command | File |
| --- | --- |
| `gws modelarmor --help` | `modelarmor.txt` |
| `gws modelarmor +sanitize-prompt --help` | `modelarmor_sanitize_prompt.txt` |
| `gws modelarmor +sanitize-response --help` | `modelarmor_sanitize_response.txt` |
| `gws modelarmor +create-template --help` | `modelarmor_create_template.txt` |

## meet (shim targets)

| Command | File |
| --- | --- |
| `gws meet spaces create --help` | `meet_spaces_create.txt` |

## forms (shim targets)

| Command | File |
| --- | --- |
| `gws forms forms create --help` | `forms_forms_create.txt` |
| `gws forms forms responses list --help` | `forms_responses_list.txt` |

## admin-reports (shim targets)

| Command | File |
| --- | --- |
| `gws admin-reports activities list --help` | `admin_reports_activities_list.txt` |
| `gws admin-reports userUsageReport get --help` | `admin_reports_user_usage_report_get.txt` |

## Notes on command-path quirks

- `gws forms forms responses list` is the full path (outer `forms` is the service,
  inner `forms` is the resource, `responses` is the sub-resource). The task brief's
  `forms responses list` shorthand omits the service prefix.
- `admin-reports usageReports get` was renamed; the actual method path is
  `admin-reports userUsageReport get` (singular, camelCase). Filename reflects the
  real command: `admin_reports_user_usage_report_get.txt`.
- Everything under a `+` prefix is a vendor helper (hand-written wrapper in the
  gws CLI); everything without is an auto-generated Discovery-doc method.
