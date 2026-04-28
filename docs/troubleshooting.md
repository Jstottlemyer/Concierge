---
title: Troubleshooting
description: Common Concierge errors with quick links to the right recovery section
---

# Concierge — Troubleshooting

Most recovery content lives in the [full onboarding guide](setup/user-onboarding.md). The map below points you to the right section for each error you might hit. Detailed write-ups for the two most common errors follow.

## Quick map: error code → where to look

| Error code | Where to go |
|---|---|
| `auth_setup_needed` | [Onboarding doc, Step 1–4](setup/user-onboarding.md#step-1--install-gws-one-command) |
| `consent_denied` | Re-run the request. If it keeps failing, onboarding doc → "Error 403: access_denied" |
| `account_revoked` | Re-authenticate the account, or remove and re-add |
| `keychain_locked` | Unlock macOS Keychain (Keychain Access.app, or log back into macOS) |
| `gatekeeper_blocked` | [Onboarding doc → "Gatekeeper blocks `gws` on first run"](setup/user-onboarding.md#gatekeeper-blocks-gws-on-first-run-after-homebrew-install) |
| `state_schema_too_new` | Upgrade Concierge, or run the recovery command shown in the error envelope |
| `network_error` | Retry; check your connection |
| `gws_error` | Inspect `gws_stderr` field in the error envelope |
| `confirmation_required` / `confirmation_mismatch` | Type the exact phrase Claude shows you |
| `read_only_active` | Ask Claude to turn off read-only mode (requires confirmation phrase) |
| `validation_error` | Fix the indicated field and ask again |
| `auth_in_progress` | Finish the in-browser consent flow, then retry |
| Project not found | [See below](#project-projectsname-not-found-or-deleted) |
| Project ID already in use | [See below](#project-id-already-in-use-at-gws-auth-setup-prompt) |

---

## "Project 'projects/<name>' not found or deleted"

**This is NOT an Anthropic / Concierge infrastructure issue.** Concierge v1 uses user-owned Google Cloud projects — there is no shared Concierge project that could be "deleted."

**What it means:** the `project_id` field in your `~/.config/gws/client_secret.json` doesn't match a real Google Cloud Project ID. Usually because `project_id` was set to a placeholder string during Cloud Console setup instead of the real Project ID.

**Fix:**
1. Find your real Project ID: [Cloud Console Dashboard](https://console.cloud.google.com/home/dashboard) → select your project → **Project info → Project ID** (a string like `my-project-abc-123456`).
2. Open `~/.config/gws/client_secret.json` in TextEdit (or any text editor):
   ```bash
   open -a TextEdit ~/.config/gws/client_secret.json
   ```
3. Find the line `"project_id": "..."` inside the `"installed"` block, replace the value with your real Project ID, save.
4. Retry. No OAuth re-auth needed — `project_id` is metadata, not credential material.

> Comfortable on the command line? `jq '.installed.project_id = "REAL_PROJECT_ID_HERE"' ~/.config/gws/client_secret.json | sponge ~/.config/gws/client_secret.json` does the same in one line (requires `brew install jq moreutils`).

## "Project ID already in use" at `gws auth setup` prompt

**What it means:** GCP Project IDs are globally unique across all of GCP (not per-account) — `concierge`, `workspace`, and other short/generic names were claimed years ago. When `gws auth setup` prompts you for a Project ID and you type one that's already taken, Google rejects the submission with this error.

**Fix:** retype with a personal suffix — `concierge-<yourlastname>` or `concierge-<company>-<YYYY>`. The display name (shown in the Cloud Console UI) is a separate field and can be anything; only the Project ID string must be globally unique.

**Not the same as** the `"Project 'projects/<x>' not found or deleted"` error above. That one happens downstream, after a wrong `project_id` lands in `~/.config/gws/client_secret.json` and every API call fails. This one is the upstream CLI prompt collision — before any `client_secret.json` exists.

See also: [`docs/setup/user-onboarding.md` Step 2 Path A](setup/user-onboarding.md#path-a-automated-via-gws-auth-setup-requires-gcloud) for the prompt-survival guidance.

---

## Common recovery commands

```bash
# Re-authenticate a single account
gws auth login --services drive,gmail

# Full local reset (removes all accounts and credentials)
rm -rf ~/.config/gws ~/Library/Application\ Support/Claude/extensions/concierge
# Then re-run onboarding Step 4 onwards.

# Verify gws is installed and sees your credentials
gws --version
gws drive files list --params '{"pageSize":3}'
```

## Still stuck

- Check the error envelope's `docs_url` field — it points directly at the doc section for that failure.
- File an issue at [github.com/Jstottlemyer/Concierge/issues](https://github.com/Jstottlemyer/Concierge/issues) with the error envelope JSON and the `gws --version` output.
