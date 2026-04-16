# Concierge — First-time User Onboarding

This is the one-time setup a user runs **before** installing the Concierge `.mcpb` into Claude Desktop. It provisions a Google Cloud OAuth client and authenticates the `gws` CLI that Concierge wraps. After this, everything is Desktop-native — you never need to touch a terminal again unless you want to.

**Time:** ~10 minutes if you have a Google account; ~20 if you're creating a Google Cloud project from scratch.

**Who this is for:** every new Concierge user, including Justin's own future setups on new machines and any third-party user who installs Concierge.

> In a hurry and comfortable at a terminal? Use [`quickstart.md`](./quickstart.md) — same install, commands only. This doc is the prose + troubleshooting companion.

---

## Prerequisites

- **macOS** (Darwin) — v1 is macOS-only (Apple Silicon or Intel)
- **Google account** — Gmail or Google Workspace
- **Claude Desktop** — download from [claude.ai/download](https://claude.ai/download) if you don't have it
- **Homebrew** — macOS package manager. Install if missing:
  ```bash
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  ```
  Verify: `brew --version` (should print `Homebrew 4.x` or similar)
- *Optional but recommended:* `gcloud` CLI — `brew install --cask google-cloud-sdk`. Lets you use `gws auth setup` (automated Cloud project creation) and the `./build/enable-apis.sh` helper. Without it, you'll use the Cloud Console UI instead.

### Node / npm — NOT needed

Concierge runs as a Claude Desktop extension (`.mcpb`). Claude Desktop includes its own bundled Node.js runtime and executes the MCP server inside it. You do **not** need to install Node, npm, or pnpm as an end user. These are only required if you're building Concierge from source.

---

## Step 1 — Install `gws` (one command)

**If you already have Homebrew:**

```bash
brew install googleworkspace-cli
gws --version   # should print "gws 0.22.x"
```

**If you don't have Homebrew** (or you want a one-shot setup):

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Jstottlemyer/Concierge/main/scripts/install-deps.sh)
```

This script installs Homebrew if missing and then installs `gws`. Safe to re-run — it skips anything already present. Source lives at `scripts/install-deps.sh` in the repo.

Both approaches install the Google Workspace CLI (`googleworkspace/cli`), which Concierge wraps. Homebrew strips the quarantine xattr so you won't hit a Gatekeeper prompt.

---

## Step 2 — Create a Google Cloud project with an OAuth client

Concierge uses OAuth 2.0, which requires a Google Cloud project that owns an OAuth client ID. Each user brings their own project (this is by design — no Concierge-owned shared client, so no data ever touches a third party).

### Path A: automated via `gws auth setup` (requires `gcloud`)

```bash
gws auth setup
```

This walks you through project selection/creation, enables the Workspace APIs, configures the consent screen, creates an OAuth client, and downloads the client secret. Skip to Step 4 when it finishes.

### Path B: manual via Google Cloud Console (no `gcloud` needed)

**B.1 — Create or pick a project.**

Open [console.cloud.google.com](https://console.cloud.google.com) and either create a new project (any display name works, e.g. `Concierge Personal`) or select an existing one.

**Find the Project ID** — this is the biggest landmine in the whole setup, so slow down here:

- Open the project selector (top-left, next to the Google Cloud logo).
- On the **Project info** card (or in the selector list), find the **Project ID** field.
- It's a Google-generated string like `my-concierge-abc-123456` — **not** the display name you typed and **not** the 12-digit Project Number.
- You can't pick the Project ID yourself; Google generates it when you create the project. If Google offered you a chance to edit it at creation time, you may have a clean one like `concierge-personal-493302`; otherwise it'll have a random suffix.

Copy the Project ID string literally. You'll paste it into Step 3.

> Why this matters: if you put a made-up label (like `"my-project"`) in the `project_id` field later, every Google API call will fail with `"Project 'projects/my-project' not found or deleted"`. That's a Google-side error — not an Anthropic or Concierge bug — and the fix is always to correct the Project ID.

**B.2 — Configure the OAuth consent screen.**

Open [console.cloud.google.com/apis/credentials/consent](https://console.cloud.google.com/apis/credentials/consent).

- **User Type:** External (lets your personal Gmail consent).
- **App name:** anything (e.g., `Concierge Personal`).
- **Support email:** your Gmail.
- **Developer contact:** your Gmail.

**B.3 — Add yourself as a Test user.**

Still on the consent screen page, scroll to **Test users** → **+ Add users** → enter your Gmail → Save.

> ⚠️ This step is non-obvious but required. Without it, consent fails with "Error 403: access_denied" and the message *"Request is not allowed for the user"*. The app stays in Testing mode indefinitely; you don't need to publish or verify.

**B.4 — Create an OAuth Client.**

Open [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials) → **+ Create Credentials** → **OAuth client ID** → **Desktop app** → any name → **Create**.

A dialog shows the Client ID and Client secret.

- If the **Download JSON** button works, save the file as `~/.config/gws/client_secret.json` and skip to Step 4.
- If download fails (common browser glitch), copy the **Client ID** and **Client secret** values instead, then proceed to Step 3.

---

## Step 3 — Write `client_secret.json` from copied values (if Step B.4 download failed)

If you have the Client ID + Client secret but not the JSON file, write it yourself:

```bash
mkdir -p ~/.config/gws
cat > ~/.config/gws/client_secret.json <<'EOF'
{
  "installed": {
    "client_id": "PASTE_CLIENT_ID_HERE.apps.googleusercontent.com",
    "project_id": "PASTE_PROJECT_ID_HERE",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
    "client_secret": "PASTE_CLIENT_SECRET_HERE",
    "redirect_uris": ["http://localhost"]
  }
}
EOF
chmod 600 ~/.config/gws/client_secret.json
```

> ⚠️ **`project_id` must be the real Google Cloud Project ID string** (e.g. `my-concierge-abc-123456`) — the one Google generated for your project, as seen in the **Project info** card in Cloud Console.
>
> It is NOT:
> - The 12-digit Project **Number** (the numeric prefix of your client_id).
> - A display name or label you invent (e.g. `concierge-personal`) — if Google didn't generate that exact string, it won't resolve.
>
> Symptom of getting this wrong: `Project 'projects/<whatever>' not found or deleted` on every API call. That error comes from Google's backend — it's not a bug in Claude, Concierge, or Anthropic. Fix: edit `~/.config/gws/client_secret.json`, correct the `project_id`, retry.

---

## Step 4 — Run OAuth login

The first login grants Concierge (via `gws`) access to Google. `gws` caches the encrypted credentials in `~/.config/gws/credentials.enc` with the encryption key stored in the macOS Keychain.

```bash
gws auth login --services drive,gmail
```

For the "startup CEO" default you'll probably want the full set immediately:

```bash
gws auth login --services drive,gmail,docs,sheets,forms,calendar,tasks
```

> ⚠️ Use `--services` (accepts service short-names like `drive,gmail,calendar`), NOT `--scopes` (which expects full scope URLs like `https://www.googleapis.com/auth/drive`). Mixing these up produces `Error 400: invalid_scope` with the message *"Some requested scopes were invalid"*.

What happens:

1. A URL prints in your terminal AND your browser opens automatically.
2. Browser shows the Google account picker — pick the Gmail you added as Test user in Step B.3.
3. Google shows a warning: *"Google hasn't verified this app"*. Click **Advanced → Go to \<app name\> (unsafe)** — this is safe because it's your own Cloud project.
4. Google shows the scope approval page. Check every service you listed → **Continue**.
5. Browser lands on *"Authentication complete. You may close this window."*
6. Terminal prints `"Authentication successful. Encrypted credentials saved."`

Confirm the result:

```bash
gws auth status
```

Returns JSON with `user`, `scopes`, `token_valid: true`, `project_id`, and `encrypted_credentials_exists: true`. If `project_id` there doesn't match the Project ID you set in Step 3, stop and fix `client_secret.json` before continuing.

> Note — `gws` v0.22.5 is effectively **single-account**: one Google account per machine. Concierge's design supports multiple accounts (you'll see `list_accounts` / `remove_account` tools), but until `gws` grows multi-account support, those tools operate on the one account you authenticate here.

---

## Step 4.5 — Enable the Google Workspace APIs for your project

**This is the most common first-use friction.** Each Google Workspace API must be explicitly enabled for your Cloud project before it can be used — this is a one-time step per API, per project.

You can do this before OR after Step 4 (OAuth login) — the only hard rule is that an API must be enabled **before** the first tool call that uses it.

**Fastest — the Concierge helper script (if you've cloned the repo and have `gcloud` installed):**

```bash
cd path/to/Concierge/packages/google-workspace
./build/enable-apis.sh              # 7 defaults: Gmail, Drive, Docs, Sheets, Forms, Calendar, Tasks
./build/enable-apis.sh "" all       # all 16 APIs (full Concierge surface)
./build/enable-apis.sh PROJECT_ID   # explicit project override
```

The script auto-detects your Project ID from `~/.config/gws/client_secret.json`, so no arg is needed if you completed Step 3.

**Raw `gcloud` one-liner** (if you have gcloud but not the repo):

```bash
gcloud services enable \
  gmail.googleapis.com \
  drive.googleapis.com \
  docs.googleapis.com \
  sheets.googleapis.com \
  forms.googleapis.com \
  calendar-json.googleapis.com \
  tasks.googleapis.com \
  --project YOUR_PROJECT_ID
```

**No `gcloud`? Enable via Cloud Console.** For each API, open this pattern and click **Enable**:

```
https://console.cloud.google.com/apis/library/<api>.googleapis.com?project=YOUR_PROJECT_ID
```

Replace `YOUR_PROJECT_ID` with your real Project ID. The seven defaults for a startup-CEO profile:

- [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com)
- [Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com)
- [Docs API](https://console.cloud.google.com/apis/library/docs.googleapis.com)
- [Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com)
- [Forms API](https://console.cloud.google.com/apis/library/forms.googleapis.com)
- [Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com)
- [Tasks API](https://console.cloud.google.com/apis/library/tasks.googleapis.com)

Optional — enable as you need them:

- Chat · Meet · People · Slides · Apps Script · Admin Reports · Classroom · Workspace Events · Model Armor

**Gotcha:** enabled APIs take ~30 seconds to propagate. If Concierge errors with `api_not_enabled` right after you enable an API, wait a moment and retry.

> Fresh Google Cloud projects have **zero** APIs enabled by default. This step is not optional; skipping it is the second-most-common reason the first real tool call fails (after a wrong `project_id`).

---

## Step 5 — Verify

```bash
gws drive files list --params '{"pageSize":3}'
```

Should return a JSON response with your most recent 3 Drive files. If you get an auth error, re-check `client_secret.json` values; if you get `"Project not found"`, re-check your `project_id` (see Step 3 warning).

---

## Step 6 — Install Concierge into Claude Desktop

```bash
open -a "Claude" path/to/Concierge-GoogleWorkspace-<version>-darwin-arm64.mcpb
```

Or drag the `.mcpb` file into **Claude Desktop → Settings → Extensions**.

> **For v1 early users:** the repo ([github.com/Jstottlemyer/Concierge](https://github.com/Jstottlemyer/Concierge)) is currently private, so you'll receive the `.mcpb` file directly from Justin rather than from GitHub Releases. Save it somewhere you can find it (e.g. `~/Downloads`) and run the command above pointing at that path.

### Verifying your download (optional, for security-conscious installers)

Releases from `google-workspace-v0.2.0` onward are **signed** with Developer ID Application and **notarized** by Apple. Three independent checks you can run against the `.mcpb` before installing — every release body also includes the same three recipes pre-filled for that version:

```bash
# 1. File-hash integrity — confirms the bytes match what was published
shasum -a 256 Concierge-GoogleWorkspace-<version>-darwin-arm64.mcpb
# compare against the 'SHA-256' line in the GitHub release body

# 2. Developer ID signature on the bundled gws binary — confirms tamper evidence
unzip -p Concierge-GoogleWorkspace-<version>-darwin-arm64.mcpb bin/gws > /tmp/gws
codesign -dvv /tmp/gws 2>&1 | grep Authority
# expected:
#   Authority=Developer ID Application: JUSTIN HAYES STOTTLEMYER (P5FDYS88B7)
#   Authority=Developer ID Certification Authority
#   Authority=Apple Root CA

# 3. SLSA build-provenance attestation — confirms CI actually produced it
gh attestation verify Concierge-GoogleWorkspace-<version>-darwin-arm64.mcpb \
  --repo Jstottlemyer/Concierge
# (requires gh CLI 2.49+)
```

If all three pass, your copy is byte-identical to what CI produced and signed for that tag. v0.1.0 was a pre-CI release and only has #2 — the SLSA attestation (#3) starts with v0.2.0.

Claude Desktop unpacks the extension to `~/Library/Application Support/Claude/Claude Extensions/local.mcpb.justin-stottlemyer.concierge-google-workspace/`.

Because `gws` is already authenticated, Concierge inherits your credentials transparently — no additional consent needed. Ask Claude:

> Use list_accounts

You should see your Google account listed with its granted bundles.

Also try:

> Use concierge_info

This returns the version, `build_time`, and `build_id` of the currently-running extension — useful if you ever need to verify Claude Desktop is actually running the build you expect (see Troubleshooting).

### Reinstalling after a rebuild

Claude Desktop doesn't always swap the unpacked extension cleanly when you re-open a new `.mcpb` on top of an old one. If tool calls behave oddly after an update, do a clean reinstall:

```bash
osascript -e 'quit app "Claude"'
rm -rf "$HOME/Library/Application Support/Claude/Claude Extensions/local.mcpb.justin-stottlemyer.concierge-google-workspace"
open -a Claude
open -a Claude path/to/Concierge-GoogleWorkspace-<version>-darwin-arm64.mcpb
```

Then verify with `Use concierge_info` and check the `build_time` matches the new build.

---

## Troubleshooting

### "API has not been used in project" / "SERVICE_DISABLED" error
- Symptom: a tool fails with a message about an API not being enabled
- Cause: the corresponding Google API isn't activated in your Cloud project
- Fix: follow Step 4.5 to enable the API; wait ~30 seconds for propagation; retry
- Concierge surfaces this as `error_code: "api_not_enabled"` with a direct enable URL in `docs_url`

### `Error 400: invalid_scope` during `gws auth login`
- Symptom: browser consent page says *"Some requested scopes were invalid"* listing `[gmail, drive]`.
- Cause: used `--scopes drive,gmail` (expects full URLs). Should be `--services drive,gmail`.
- Fix: re-run with correct flag.

### `Error 403: access_denied` during consent
- Symptom: browser shows `Error 403: access_denied` after login.
- Cause: your Gmail is not added as a Test user on the OAuth consent screen.
- Fix: add yourself at [console.cloud.google.com/apis/credentials/consent](https://console.cloud.google.com/apis/credentials/consent) → Test users → + Add users. Retry.

### `Project 'projects/xxx' not found or deleted`
- Symptom: auth succeeds but API calls fail with this error (you may see it surfaced in Claude Desktop as a tool-call failure).
- Cause: the `project_id` in `~/.config/gws/client_secret.json` doesn't match a real Google Cloud Project ID. Usually this means someone typed a made-up label (like `concierge-personal`) instead of the auto-generated string (like `my-concierge-abc-123456`).
- Fix: look up the real Project ID in Cloud Console **Project info** card (NOT the Project Number, NOT a label you invented), edit `~/.config/gws/client_secret.json` to match, retry.
- Note: this error message comes directly from Google's API backend. It is **not** an Anthropic or Concierge bug, even though you may see it routed through Claude's response. Relates to [Step 2 B.1](#b1--create-or-pick-a-project) and [Step 3](#step-3--write-client_secretjson-from-copied-values-if-step-b4-download-failed).

### Tool calls fail / behave oddly right after you reinstalled the `.mcpb`
- Symptom: Claude Desktop acts like it's running an older version — missing tools, wrong outputs, stale error messages.
- Cause: Claude Desktop sometimes doesn't swap the unpacked extension when you re-open a `.mcpb` on top of an existing install.
- Fix: do the clean-reinstall sequence from [Step 6](#step-6--install-concierge-into-claude-desktop) (`quit Claude`, `rm -rf` the extension dir, reopen, re-install).
- Verify: `Use concierge_info` and confirm `build_time` / `build_id` match the new build.

### Generic "Tool execution failed" with no useful detail
- Ask Claude: `Use concierge_info`. Note the `build_time`.
- If it's older than your most recent rebuild, do the clean reinstall ([Step 6](#reinstalling-after-a-rebuild)).
- If it's current, the issue is elsewhere — check `gws auth status` in a terminal and re-run Step 5's verify command.

### "Google hasn't verified this app" warning
- Normal for Testing-mode apps. Click **Advanced → Go to \<app name\> (unsafe)**. Safe because it's your own Cloud project.

### Gatekeeper blocks `gws` on first run after Homebrew install
- Rare because Homebrew strips quarantine, but if you ran `brew install --no-quarantine` or installed from the raw tarball:
  - `xattr -d com.apple.quarantine $(which gws)` to remove the xattr manually, or
  - System Settings → Privacy & Security → scroll to the gws entry → **Open Anyway**.

### Forgot to copy client_secret, Cloud Console hides it now
- OAuth client page → click the client → **Reset client secret** → copy the new one → update `~/.config/gws/client_secret.json`.

### Lost `~/.config/gws/`
- Re-run Step 4 (`gws auth login`). The Cloud project + OAuth client persist; only the local credential file needs to be regenerated.

---

## What's next

After this one-time bootstrap, Concierge handles everything. You never touch the terminal again unless you want to.

- First-use of each service bundle in Concierge triggers an in-browser consent prompt (the browser opens from Claude Desktop itself — no terminal needed after setup).
- Adding a second Google account: just use Concierge tools with an unfamiliar `account` parameter and you'll be prompted to consent.
- Revoking: use `remove_account` (per-account) or `factory_reset` (everything) from inside Claude Desktop.
- Full removal: run `factory_reset` then uninstall the extension from Claude Desktop.

## Coexistence with claude.ai's Google connectors (Gmail / Calendar / Drive)

Claude Desktop can connect to Google services through **two independent paths**:

| | claude.ai hosted connectors | Concierge (local `.mcpb`) |
|---|---|---|
| Where it runs | Anthropic's servers | Your Mac |
| Auth | Grant via claude.ai's OAuth | Your own GCP project, local keychain |
| Data flow | Through Anthropic | Never leaves your Mac |
| Setup | Few clicks in Claude settings | This doc (one-time) |
| Coverage | Gmail (read + drafts), Calendar (comprehensive), Drive (search + read + analyze + convert) | Gmail (send + reply + forward + watch), Drive (upload + list + download + share), plus 10 services claude.ai doesn't cover: Docs, Sheets, Slides, Forms, Tasks, Chat, Meet, Keep, Classroom, Admin Reports, Apps Script |
| Best for | Quick read/search/summarize workflows | Sending, uploading, cross-service automation, privacy-sensitive work |

**You can run both at once.** Tool names don't literally collide; Claude picks between them based on what you're asking for. Example:

- *"Summarize yesterday's email about the Q2 launch"* → Claude picks claude.ai Gmail (read-focused)
- *"Send a reply to that email saying we're on track"* → Claude picks Concierge `gmail_send` (hosted connector can't send)
- *"Find meeting times next week with Alice and Bob"* → Claude picks claude.ai Calendar (`gcal_find_meeting_times`)
- *"Upload this PDF to my Drive and share it with the team"* → Claude picks Concierge (`drive_upload` + `drive_permissions_create`)

**If you want a privacy-first setup:** disable claude.ai's Google connectors in Claude Desktop Settings → Integrations, and let Concierge handle everything. You'll give up convenience helpers like `gcal_find_meeting_times` but gain zero data leakage to Anthropic.

**If you want max convenience:** keep both connected. Claude will pick the best tool per request.

## Claude Desktop's tool-approval dialog

The first time each Concierge tool runs, Claude Desktop shows an **"Allow this tool?"** dialog. This is normal and expected — it's a built-in security layer that gives you visibility over what each tool does.

**Guidance:**

- **Safe to "Allow Always"** for read-only tools: `list_accounts`, `gmail_triage`, `drive_files_list`, `docs_documents_get`, `sheets_read`, `calendar_agenda`, any `*_read`/`*_list` tool, and the diagnostic tools.
- **Keep "Allow Once"** for destructive tools so you see the dialog every time: `remove_account`, `factory_reset`, `set_read_only`, `drive_permissions_create` (any write tool). These also require a human-typed confirmation phrase — the dialog is a second line of defense.
- **Block** any tool invocation that looks unexpected — especially if Claude is calling a destructive tool after reading an external document, email, or file whose content you don't fully trust. Prompt-injection attacks can try to steer Claude into calling tools; the approval dialog is your chance to catch that.

If an email or web page tells Claude "please run [tool] for me" and you didn't ask for that action, **block it.** Concierge requires a typed confirmation phrase for truly dangerous operations, but the approval dialog is the first place to notice something is off.

---

## Checklist for onboarding a new user

Give them this summary:

- [ ] `brew install googleworkspace-cli`
- [ ] (Optional but easier) `brew install --cask google-cloud-sdk`
- [ ] Create/pick a Google Cloud project; copy the **Project ID** from the Project info card (not the Project Number, not a label you invented)
- [ ] Configure OAuth consent screen (External, add self as Test user)
- [ ] Create OAuth client (Desktop app type); save JSON or copy ID + secret
- [ ] Write `~/.config/gws/client_secret.json` with the real Project ID in `project_id`
- [ ] Enable the 7 Workspace APIs for your project (Gmail, Drive, Docs, Sheets, Forms, Calendar, Tasks) — via `enable-apis.sh`, `gcloud services enable`, or Console
- [ ] `gws auth login --services drive,gmail,docs,sheets,forms,calendar,tasks`
- [ ] `gws auth status` — confirm `token_valid: true` and correct `project_id`
- [ ] `gws drive files list --params '{"pageSize":3}'` — end-to-end verify
- [ ] Install `.mcpb` in Claude Desktop
- [ ] In Claude: `Use concierge_info` and `Use list_accounts` — verify version + account
