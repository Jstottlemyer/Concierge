# Concierge — First-time User Onboarding

This is the one-time setup a user runs **before** installing the Concierge `.mcpb` into Claude Desktop. It provisions a Google Cloud OAuth client and authenticates the `gws` CLI that Concierge wraps. After this, everything is Desktop-native.

**Time:** ~10 minutes if you have a Google account; ~20 if creating a Cloud project from scratch.

**Who this is for:** every new Concierge user, including Justin's own future setups on new machines and any third-party user who installs Concierge.

---

## Prerequisites

- macOS (Darwin) — v1 is macOS-only
- Google account (Gmail or Workspace)
- Homebrew installed (`brew --version`)
- Claude Desktop installed
- *Optional but easier:* `gcloud` CLI installed (`brew install --cask google-cloud-sdk`) — lets you use `gws auth setup` which automates project creation

---

## Step 1 — Install `gws` (one command)

```bash
brew install googleworkspace-cli
gws --version   # should print "gws 0.22.x"
```

This installs the Google Workspace CLI (`googleworkspace/cli`), which Concierge wraps. Homebrew strips the quarantine xattr so you won't hit a Gatekeeper prompt.

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

Open [console.cloud.google.com](https://console.cloud.google.com) and either create a new project (any name, e.g. `authtools-personal`) or select an existing one. **Note the Project ID** (the string under the project name — usually like `authtools-personal-123456`). You'll need it in Step 3.

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

> ⚠️ **The `project_id` field must match your actual Google Cloud Project ID** (the string, not the numeric number). Using a placeholder like `"authtools-personal"` will yield `"Project 'projects/xxx' not found or deleted"` from Google when you try to make API calls. You can find the real Project ID on the Cloud Console project selector.

---

## Step 4 — Run OAuth login

The first login grants Concierge (via `gws`) access to Google. `gws` caches the encrypted credentials in `~/.config/gws/credentials.enc` with the encryption key stored in the macOS Keychain.

```bash
gws auth login --services drive,gmail
```

> ⚠️ Use `--services` (accepts service names like `drive,gmail,calendar`), NOT `--scopes` (which expects full scope URLs). Mixing these up produces `Error 400: invalid_scope` with the message *"Some requested scopes were invalid"*.

What happens:

1. A URL prints in your terminal AND your browser opens automatically.
2. Browser shows the Google account picker — pick the Gmail you added as Test user in Step B.3.
3. Google shows a warning: *"Google hasn't verified this app"*. Click **Advanced → Go to \<app name\> (unsafe)** — this is safe because it's your own Cloud project.
4. Google shows the scope approval page. Check both Drive and Gmail → **Continue**.
5. Browser lands on *"Authentication complete. You may close this window."*
6. Terminal prints `"Authentication successful. Encrypted credentials saved."`

---

## Step 4.5 — Enable the Google Workspace APIs for your project

**This is the most common first-use friction.** Each Google Workspace API must be explicitly enabled for your Cloud project before it can be used — this is a one-time step per API, per project.

Open your project's API Library and enable the APIs for the services you plan to use:

https://console.cloud.google.com/apis/library?project=YOUR_PROJECT_ID

Or go straight to each API's enable page. For the "startup CEO" default (Gmail + Drive + Docs + Sheets + Forms + Calendar + Tasks), enable these seven:

- [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com)
- [Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com)
- [Docs API](https://console.cloud.google.com/apis/library/docs.googleapis.com)
- [Sheets API](https://console.cloud.google.com/apis/library/sheets.googleapis.com)
- [Forms API](https://console.cloud.google.com/apis/library/forms.googleapis.com)
- [Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com)
- [Tasks API](https://console.cloud.google.com/apis/library/tasks.googleapis.com)

Replace `YOUR_PROJECT_ID` in each URL with your Cloud project ID before clicking.

Optional — enable as you need them:

- Chat · Meet · People · Slides · Apps Script · Admin Reports · Workspace Events

**Fastest — use the Concierge helper script (if `gcloud` is installed):**

```bash
./build/enable-apis.sh              # enables the 7 defaults for startup-CEO use
./build/enable-apis.sh "" all       # enables all 16 APIs (full Concierge surface)
./build/enable-apis.sh PROJECT_ID   # explicit project
```

The script auto-detects your project ID from `~/.config/gws/client_secret.json` (no arg needed if you completed Step 3).

**Manual `gcloud` alternative:** if gcloud is installed but you prefer the raw command:

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

**Gotcha:** enabled APIs take ~30 seconds to propagate. If Concierge errors with "api_not_enabled" right after you enable an API, wait a moment and retry.

---

## Step 5 — Verify

```bash
gws drive files list --params '{"pageSize":3}'
```

Should return a JSON response with your most recent 3 Drive files. If you get an auth error, re-check `client_secret.json` values; if you get `"Project not found"`, re-check your `project_id` (see Step 3 warning).

---

## Step 6 — Install Concierge into Claude Desktop

```bash
open -a "Claude" path/to/Concierge-<version>-darwin-arm64.mcpb
```

Or drag the `.mcpb` file into **Claude Desktop → Settings → Extensions**.

Because `gws` is already authenticated, Concierge inherits your credentials transparently — no additional consent needed. Ask Claude:

> Use list_accounts

And you should see your Google account listed with its granted bundles.

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
- Symptom: auth succeeds but API calls fail with this error.
- Cause: `project_id` in `client_secret.json` doesn't match a real Google Cloud Project ID.
- Fix: look up the real Project ID in Cloud Console (NOT the project number), edit `~/.config/gws/client_secret.json` to match.

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
- [ ] Create/pick a Google Cloud project, note its Project ID
- [ ] Configure OAuth consent screen (External, add self as Test user)
- [ ] Create OAuth client (Desktop app type)
- [ ] Save credentials at `~/.config/gws/client_secret.json` (with real Project ID)
- [ ] `gws auth login --services drive,gmail`
- [ ] `gws drive files list --params '{"pageSize":3}'` — verify
- [ ] Install `.mcpb` in Claude Desktop
- [ ] In Claude: `Use list_accounts` — verify account appears
