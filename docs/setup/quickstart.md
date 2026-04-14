# Concierge — Quickstart

For terminal users who want the condensed recipe. Full prose + troubleshooting:
[user-onboarding.md](./user-onboarding.md).

## Prereqs

- macOS (arm64 or x64)
- Homebrew, Claude Desktop, a Google account
- ~10 minutes

## Commands

### 1. Install `gws` CLI

```bash
brew install googleworkspace-cli
gws --version   # expect 0.22.x
```

### 2. Install `gcloud` (optional, halves the setup time)

```bash
brew install --cask google-cloud-sdk
gcloud auth login
```

### 3. Create a Google Cloud project + OAuth client

**With `gcloud`** (one command):

```bash
gws auth setup   # walks through project, consent screen, OAuth client, JSON download
```

**Without `gcloud`** (Console checklist — copy your real **Project ID** from the Project info card, not the Project Number):

1. https://console.cloud.google.com → create project → copy **Project ID** (e.g. `my-concierge-abc-123456`)
2. APIs & Services → OAuth consent screen → **External** → fill required fields → add yourself under **Test users**
3. APIs & Services → Credentials → **+ Create Credentials** → OAuth client ID → **Desktop app** → Create
4. Download JSON to `~/.config/gws/client_secret.json` (or write it manually — template in [user-onboarding.md Step 3](./user-onboarding.md#step-3--write-client_secretjson-from-copied-values-if-step-b4-download-failed))
5. `chmod 600 ~/.config/gws/client_secret.json`
6. Verify `project_id` inside the JSON equals the Project ID string from step 1

### 4. Enable required Google APIs

**With the repo cloned + `gcloud`:**

```bash
cd path/to/Concierge/packages/google-workspace
./build/enable-apis.sh           # 7 APIs: gmail, drive, docs, sheets, forms, calendar, tasks
# ./build/enable-apis.sh "" all  # all 16 APIs
```

**With `gcloud` only:**

```bash
gcloud services enable \
  gmail.googleapis.com drive.googleapis.com docs.googleapis.com \
  sheets.googleapis.com forms.googleapis.com calendar-json.googleapis.com \
  tasks.googleapis.com \
  --project YOUR_PROJECT_ID
```

**Without `gcloud`:** open each URL and click **Enable** (~30s propagation after each):

```
https://console.cloud.google.com/apis/library/<api>.googleapis.com?project=YOUR_PROJECT_ID
```

### 5. Authenticate

```bash
gws auth login --services drive,gmail,docs,sheets,forms,calendar,tasks
# --services takes short names; --scopes would expect full URLs (don't confuse them)
```

### 6. Verify

```bash
gws auth status                                      # token_valid: true, correct project_id
gws drive files list --params '{"pageSize":3}'       # JSON of 3 recent Drive files
```

### 7. Install Concierge in Claude Desktop

```bash
open -a "Claude" path/to/Concierge-GoogleWorkspace-<version>-darwin-arm64.mcpb
```

> v1 note: the repo is currently private; you'll receive the `.mcpb` directly from Justin rather than from GitHub Releases.

### 8. Test in Claude Desktop

```
Use concierge_info        # shows version, build_time, build_id
Use list_accounts         # confirms your Google account
Triage my Gmail inbox     # end-to-end live call
```

### Reinstall (after a rebuild)

```bash
osascript -e 'quit app "Claude"'
rm -rf "$HOME/Library/Application Support/Claude/Claude Extensions/local.mcpb.justin-stottlemyer.concierge-google-workspace"
open -a Claude
open -a Claude path/to/Concierge-GoogleWorkspace-<version>-darwin-arm64.mcpb
```

## Troubleshooting

- `Project 'projects/X' not found or deleted` → `project_id` in `~/.config/gws/client_secret.json` must be the **real** Cloud Project ID string from the Console's Project info card, not the Project Number and not a label you invented.
- `Error 400: invalid_scope` during `gws auth login` → use `--services drive,gmail` (short names), not `--scopes`.
- `Error 403: access_denied` during browser consent → add your Gmail as a **Test user** on the OAuth consent screen.
- `api_not_enabled` in a Claude tool response → run `./build/enable-apis.sh` (or enable via Console); wait ~30s for propagation.
- Tool calls fail after a rebuild / missing tools / stale behavior → do the hard reinstall sequence above, then `Use concierge_info` to verify `build_time`.
- Generic "Tool execution failed" → `Use concierge_info`; if `build_time` is stale, reinstall; otherwise check `gws auth status` in a terminal.
