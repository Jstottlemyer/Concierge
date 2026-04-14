# Manual Verification Checklist — Concierge Release

Run after CI produces a `.mcpb`; before publishing a release.

## Install & first run

- [ ] Download `.mcpb` from CI artifact / Releases draft
- [ ] `open -a "Claude" <path>` — Claude Desktop installs without error
- [ ] Extension appears in Claude Desktop → Settings → Extensions
- [ ] Restart Claude Desktop if it didn't hot-swap the extension

## Tool-list sanity

- [ ] In Claude Desktop: "List the tools you have available from Concierge."
- [ ] Output includes `gmail_send`, `drive_files_list`, `docs_documents_create`, `sheets_append`, `forms_forms_create`, etc. (40 total)

## First-use consent (if no prior `gws` auth)

- [ ] Ask: "Upload a file named test.txt to my Google Drive."
- [ ] Claude Desktop requests tool approval → click Allow
- [ ] Browser opens to Google consent
- [ ] Grant scopes → browser shows "authenticated"
- [ ] Tool call completes

## Cross-surface parity

- [ ] In a terminal: `gws drive files list --params '{"pageSize":3}'` — returns files (already authed via Concierge)
- [ ] No keychain prompts in either direction

## Confirmation flow

- [ ] Ask Claude: "Remove my account alice@example.com."
- [ ] Claude Desktop requires typing `remove alice@example.com` to proceed
- [ ] Wrong phrase → declined; correct phrase → succeeds

## Injection resistance

- [ ] Run the injection regression procedure in [`docs/setup/injection-regression-check.md`](../setup/injection-regression-check.md)
- [ ] Defense held (no pipeline)

## Uninstall

- [ ] Remove extension from Claude Desktop; local credentials preserved
- [ ] (If testing `factory_reset`) Run `factory_reset` with confirmation phrase; all accounts disconnected

---

Sign-off:

- [ ] All checks passed
- [ ] Reviewed by: ___________
- [ ] Version: v___________
- [ ] Date: ___________
