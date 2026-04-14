# Concierge — Troubleshooting

Short index. Most real recovery content lives in:

- [`docs/setup/user-onboarding.md`](setup/user-onboarding.md) — step-by-step onboarding, including a full Troubleshooting section covering `invalid_scope`, `access_denied`, missing Project ID, Gatekeeper, and lost `~/.config/gws/`.
- [`src/errors/user-messages.ts`](../src/errors/user-messages.ts) — canonical user-facing copy for every error code Concierge emits. Each entry has a `summary` (what happened), a `next_action` (what to try), and often a `docs_url` pointing back here or to the onboarding doc.

## "Project 'projects/<name>' not found or deleted"

**This is NOT an Anthropic / Concierge infrastructure issue.** Concierge v1 uses user-owned Google Cloud projects — there is no shared Concierge project that could be "deleted."

**What it means:** the `project_id` field in your `~/.config/gws/client_secret.json` doesn't match a real Google Cloud Project ID. Usually because `project_id` was set to a placeholder string during Cloud Console setup instead of the real Project ID.

**Fix:**
1. Find your real Project ID: [Cloud Console Dashboard](https://console.cloud.google.com/home/dashboard) → select your project → **Project info → Project ID** (a string like `my-project-abc-123456`).
2. Update `~/.config/gws/client_secret.json`:
   ```bash
   python3 -c "
   import json
   p = '$HOME/.config/gws/client_secret.json'
   d = json.load(open(p))
   d['installed']['project_id'] = 'REAL_PROJECT_ID_HERE'
   json.dump(d, open(p, 'w'), indent=2)
   print('updated')
   "
   ```
3. Retry. No OAuth re-auth needed — `project_id` is metadata, not credential material.

## Quick map: error code → where to look

| Error code | Where to go |
|---|---|
| `auth_setup_needed` | [Onboarding doc, Step 1–4](setup/user-onboarding.md#step-1--install-gws-one-command) |
| `consent_denied` | Re-run the request. If it keeps failing, onboarding doc → "Error 403: access_denied" |
| `account_revoked` | Re-authenticate the account, or remove and re-add |
| `keychain_locked` | Unlock macOS Keychain (Keychain Access.app, or log back into macOS) |
| `gatekeeper_blocked` | Onboarding doc → "Gatekeeper blocks `gws` on first run" |
| `state_schema_too_new` | Upgrade Concierge, or run the recovery command shown in the error envelope |
| `network_error` | Retry; check your connection |
| `gws_error` | Inspect `gws_stderr` field in the error envelope |
| `confirmation_required` / `confirmation_mismatch` | Type the exact phrase Claude shows you |
| `read_only_active` | Ask Claude to turn off read-only mode (requires confirmation phrase) |
| `validation_error` | Fix the indicated field and ask again |
| `auth_in_progress` | Finish the in-browser consent flow, then retry |

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
