---
title: Full Setup Walkthrough
description: One-command setup for Concierge — what the orchestrator does, what you'll see, and a manual fallback if anything goes sideways
---

# Concierge — First-time User Onboarding

Concierge installs in one command. The orchestrator handles Homebrew, the `gws`
CLI, gcloud, your Google Cloud project + OAuth client, API enablement, OAuth
login, and the `.mcpb` install into Claude Desktop. You stay in your terminal,
answer a couple of consent prompts, click through the OAuth screen in your
browser, and you're done.

**Time:** ~5-10 minutes if you have a Google account; most of that is OAuth click time.

> Already comfortable at a terminal? [`quickstart.md`](./quickstart.md) is the
> condensed recipe. This doc adds the prose: what the script is doing, what
> you'll see, and a manual fallback if the bootstrap doesn't finish cleanly.

---

## On this page

1. [Prerequisites](#prerequisites)
2. [The one command](#the-one-command)
3. [What the orchestrator does](#what-the-orchestrator-does)
4. [Workspace vs personal Gmail](#workspace-vs-personal-gmail)
5. [Verifying the download](#verifying-the-download)
6. [Manual fallback](#manual-fallback)
7. [Troubleshooting](#troubleshooting)
8. [What's next](#whats-next)
9. [Coexistence with claude.ai's Google connectors](#coexistence-with-claudeais-google-connectors-gmail--calendar--drive)
10. [Claude Desktop's tool-approval dialog](#claude-desktops-tool-approval-dialog)

---

## Prerequisites

- **macOS** (Darwin) — v1 is macOS-only (Apple Silicon or Intel)
- **Google account** — Gmail or Google Workspace
- **Claude Desktop** — download from [claude.ai/download](https://claude.ai/download) if you don't have it
- A working internet connection — that's it

The orchestrator installs Homebrew, `gws`, and (optionally) `gcloud` for you if
they're missing. You don't need to set anything up by hand first.

### Node / npm — NOT needed

Concierge runs as a Claude Desktop extension (`.mcpb`). Claude Desktop includes
its own bundled Node.js runtime and executes the MCP server inside it. You do
**not** need Node, npm, or pnpm as an end user. These are only required if
you're building Concierge from source.

---

## The one command

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Jstottlemyer/Concierge/main/scripts/setup.sh)
```

That's the whole install. The script is a tiny bootstrap that:

1. Detects your OS + architecture (`darwin-arm64` or `darwin-x64`).
2. Downloads the signed `@concierge/setup` binary tarball for that arch from the
   latest GitHub release.
3. Verifies the tarball's sha256 against the published hash.
4. Verifies the [Sigstore cosign](https://docs.sigstore.dev/) signature against
   the keyless certificate published with the release.
5. Extracts the binary and execs it with whatever args you passed.

To pin a specific version (otherwise defaults to latest):

```bash
VERSION=2.0.0 bash <(curl -fsSL https://raw.githubusercontent.com/Jstottlemyer/Concierge/main/scripts/setup.sh)
```

If you'd like to inspect the bootstrap before piping it to bash, see the
[Quickstart's verification path](./quickstart.md#verification) — it shows how to
download `setup.sh` separately, sha256-check it, then run it.

---

## What the orchestrator does

Once the binary takes over, you'll see roughly this sequence on screen:

### 1. Banner + consent

A short banner identifying the build (version, build_time, build_id) followed by
a plain-English summary of what the orchestrator is about to do, and a
**y/N consent prompt** before any system change. Decline at any point and the
script exits cleanly without modifying anything.

### 2. Probe scan

The orchestrator inspects your machine and reports what's already in place vs
what's missing — Homebrew, `gws`, gcloud, an existing `~/.config/gws/`, Claude
Desktop, prior Concierge install. Each missing item gets its own confirm-before-install
prompt; nothing gets installed silently.

### 3. Install progress

For each missing prerequisite, the orchestrator runs the canonical install
command (e.g. `brew install googleworkspace-cli`) and streams progress with
timestamps. If a step fails it stops, prints the underlying error, and points
you at the relevant troubleshooting entry.

### 4. Cloud project + OAuth client

If you don't already have `~/.config/gws/client_secret.json`, the orchestrator
creates a Google Cloud project, configures the OAuth consent screen, creates a
Desktop-type OAuth client, and writes `client_secret.json` for you. Where Google
hasn't shipped a `gcloud` API for a step (e.g. creating Desktop OAuth clients),
the orchestrator opens the right Cloud Console URL in your browser and waits
for you to confirm completion.

### 5. OAuth login + browser wait

`gws auth login --services …` runs with the full default service set (Gmail,
Sheets, Docs, Drive, Forms, Calendar, Tasks, Slides, Chat, Meet, People, Apps
Script). Your browser opens to Google's account picker; pick your account,
approve scopes, and the orchestrator detects completion and continues.

### 6. API enablement + verify

The Workspace APIs for your project get enabled (Gmail, Sheets, Docs, …). The
orchestrator runs a `gws drive files list` smoke test to confirm everything is
working end-to-end, then registers the `.mcpb` into Claude Desktop.

### 7. Success screen

A summary screen with the build version installed, the Google account
authenticated, and two test prompts to paste into Claude Desktop:

> Use concierge_info
> Use list_accounts

The first confirms the freshly-installed extension is the one Claude Desktop is
running (matches `build_time`). The second confirms your Google account is
visible to Concierge.

The orchestrator is **idempotent** — re-run it any time. It skips work already
done and only acts on whatever's still missing or broken.

---

## Workspace vs personal Gmail

The orchestrator detects whether you're authenticating a **personal Gmail** or
a **Google Workspace** account and walks you through the right flow
automatically.

- **Personal Gmail:** the Cloud project + OAuth consent screen are created in
  Testing mode with you as the sole Test user. Standard "Google hasn't verified
  this app" warning during consent — safe because it's your own project.
- **Workspace account, you're an admin:** the orchestrator can complete the
  flow end-to-end same as personal.
- **Workspace account, you're not an admin:** the orchestrator generates a
  pre-filled instructions file at `~/Desktop/concierge-admin-instructions-<timestamp>.txt`
  that you forward to your Workspace admin. The file contains the exact steps,
  Cloud Console URLs, and scopes the admin needs to approve. Re-run the
  orchestrator after they're done; it picks up where it left off.

---

## Verifying the download

Releases from `v2.0.0` onward are signed with both **Sigstore cosign** (the
setup binary) and **Apple Developer ID + notarization** (the `.mcpb`).
Independent checks you can run:

```bash
# 1. Bootstrap script integrity
curl -fsSL -o /tmp/setup.sh https://raw.githubusercontent.com/Jstottlemyer/Concierge/main/scripts/setup.sh
shasum -a 256 /tmp/setup.sh
# Compare against https://jstottlemyer.github.io/Concierge/setup.sh.sha256

# 2. .mcpb file-hash integrity (after the orchestrator installs it)
shasum -a 256 Concierge-GoogleWorkspace-<version>-darwin-arm64.mcpb
# Compare against the SHA-256 line in the GitHub release body

# 3. .mcpb Developer ID signature on the bundled gws binary
unzip -p Concierge-GoogleWorkspace-<version>-darwin-arm64.mcpb bin/gws > /tmp/gws
codesign -dvv /tmp/gws 2>&1 | grep Authority
# expected:
#   Authority=Developer ID Application: JUSTIN HAYES STOTTLEMYER (P5FDYS88B7)
#   Authority=Developer ID Certification Authority
#   Authority=Apple Root CA

# 4. SLSA build-provenance attestation
gh attestation verify Concierge-GoogleWorkspace-<version>-darwin-arm64.mcpb \
  --repo Jstottlemyer/Concierge
# (requires gh CLI 2.49+)
```

If you want to pin every artifact yourself (no curl-to-bash anywhere in the
chain), use the [Manual fallback → advanced `gh release download` path](#advanced-pin-every-artifact-with-gh-release-download)
below.

---

## Manual fallback

The orchestrator covers the happy path. If you want to understand exactly what
it's doing, recover from a partial bootstrap, or pin every artifact yourself,
the manual recipe is here. **You don't need this for a normal install** — it's a
reference for the curious or for recovery.

### Advanced: pin every artifact with `gh release download`

This skips the curl-to-bash bootstrap entirely. You download the setup binary
tarball + sha256 + cosign signature + cert directly from the release, verify
locally, extract, and run the binary by hand:

```bash
VERSION=2.0.0
gh release download "release-v${VERSION}" \
  --repo Jstottlemyer/Concierge \
  --pattern "@concierge/setup-${VERSION}-darwin-arm64.tar.gz" \
  --pattern "@concierge/setup-${VERSION}-darwin-arm64.tar.gz.sha256" \
  --pattern "@concierge/setup-${VERSION}-darwin-arm64.tar.gz.sig" \
  --pattern "@concierge/setup-${VERSION}-darwin-arm64.tar.gz.pem"
shasum -a 256 -c "@concierge/setup-${VERSION}-darwin-arm64.tar.gz.sha256"
cosign verify-blob \
  --signature "@concierge/setup-${VERSION}-darwin-arm64.tar.gz.sig" \
  --certificate "@concierge/setup-${VERSION}-darwin-arm64.tar.gz.pem" \
  --certificate-identity-regexp '.*' \
  --certificate-oidc-issuer-regexp '.*' \
  "@concierge/setup-${VERSION}-darwin-arm64.tar.gz"
mkdir -p /tmp/concierge-setup
tar -xzf "@concierge/setup-${VERSION}-darwin-arm64.tar.gz" -C /tmp/concierge-setup
node /tmp/concierge-setup/dist/index.js
```

The `node` invocation runs the same orchestrator the bootstrap would have
exec'd — just without the curl pipe.

### Step-by-step manual recipe

If you want to do every step yourself (or recover from a partial bootstrap),
this is what the orchestrator runs under the hood.

**1. Install Homebrew.**

```bash
brew --version 2>/dev/null || /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

**2. Install `gws` and (optionally) `gcloud`.**

```bash
brew install googleworkspace-cli
brew install --cask google-cloud-sdk    # optional — halves setup time
gws --version    # expect 0.22.x
```

**3. Create a Google Cloud project + OAuth client.**

If you have `gcloud`, the easy path is:

```bash
gws auth setup
```

This walks you through project selection/creation, consent screen, and OAuth
client. **If it prompts for a Project ID** and rejects your first try with
*"Project ID already in use globally"*: don't use `concierge` or other short
generic names — they're claimed. Try `concierge-<yourlastname>` or
`concierge-<company>-<YYYY>`.

**If `gws auth setup` punts OAuth client creation back to you**, that's expected
— Google has never shipped a `gcloud` API for creating Desktop-type OAuth
clients. Open the project in [Cloud Console](https://console.cloud.google.com),
go to **APIs & Services → Credentials → + Create Credentials → OAuth client ID
→ Desktop app**, save the JSON to `~/.config/gws/client_secret.json`, and
`chmod 600` it.

**Without `gcloud`,** do everything in the Cloud Console:

1. [console.cloud.google.com](https://console.cloud.google.com) → create
   project → copy the **Project ID** from the **Project info** card. The
   Project ID is a Google-generated string like `my-concierge-abc-123456` —
   **not** the display name and **not** the 12-digit Project Number. Getting
   this wrong is the #1 cause of `Project 'projects/X' not found or deleted`
   errors later.
2. **APIs & Services → OAuth consent screen → External** → fill required fields →
   add yourself as a **Test user**. Without the Test-user step, consent fails
   with `Error 403: access_denied`.
3. **APIs & Services → Credentials → + Create Credentials → OAuth client ID →
   Desktop app** → Create.
4. Download the JSON to `~/.config/gws/client_secret.json` (or write it
   manually using the template in [Step 3a](#step-3a--write-client_secretjson-from-copied-values) below)
   and `chmod 600` it.
5. Verify the `project_id` field inside the JSON matches the **Project ID
   string** from step 1.

#### Step 3a — Write `client_secret.json` from copied values

If the Cloud Console download glitched and you have just the Client ID + Client
secret values:

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

> ⚠️ `project_id` must be the **real Google Cloud Project ID string**
> (e.g. `my-concierge-abc-123456`), as shown in the Project info card. NOT the
> 12-digit Project Number, NOT a label you invent. Symptom of getting it wrong:
> `Project 'projects/<whatever>' not found or deleted` on every API call. That
> error comes from Google's backend, not from Concierge.

**4. Run OAuth login.**

```bash
gws auth login --services gmail,sheets,docs,drive,forms,calendar,tasks,slides,chat,meet,people,script
```

> Use `--services` (short names like `drive,gmail`), NOT `--scopes` (which
> expects full URLs). Mixing them produces `Error 400: invalid_scope`.

A URL prints in the terminal AND the browser opens automatically. Pick your
Google account → click **Advanced → Go to \<app name\> (unsafe)** through the
"Google hasn't verified this app" warning (safe because it's your own project) →
approve scopes → wait for the success page.

Confirm:

```bash
gws auth status   # token_valid: true, correct project_id
```

> Note — `gws` v0.22.5 is effectively single-account per machine. Concierge's
> `list_accounts` / `remove_account` tools are wired for multi-account but
> operate on the one account `gws` knows about until upstream support lands.

**5. Enable the Google Workspace APIs.**

If you have the repo cloned + `gcloud`:

```bash
cd path/to/Concierge/packages/google-workspace
./build/enable-apis.sh              # 12 defaults
./build/enable-apis.sh "" all       # all 16 APIs (adds Admin Reports, Classroom, Workspace Events, Model Armor)
```

With just `gcloud`:

```bash
gcloud services enable \
  gmail.googleapis.com sheets.googleapis.com docs.googleapis.com \
  drive.googleapis.com forms.googleapis.com calendar-json.googleapis.com \
  tasks.googleapis.com slides.googleapis.com chat.googleapis.com \
  meet.googleapis.com people.googleapis.com script.googleapis.com \
  --project YOUR_PROJECT_ID
```

Without `gcloud`, open each enable URL and click **Enable** (~30s propagation):

```
https://console.cloud.google.com/apis/library/<api>.googleapis.com?project=YOUR_PROJECT_ID
```

The 12 defaults: Gmail, Sheets, Docs, Drive, Forms, Calendar, Tasks, Slides,
Chat, Meet, People, Apps Script. Optional add-ons (admin / edu / paid): Admin
Reports, Classroom, Workspace Events, Model Armor.

**6. Verify end-to-end.**

```bash
gws drive files list --params '{"pageSize":3}'
```

Returns JSON of your 3 most recent Drive files.

**7. Install Concierge into Claude Desktop.**

```bash
open -a "Claude" path/to/Concierge-GoogleWorkspace-<version>-darwin-arm64.mcpb
```

Or drag the `.mcpb` into **Claude Desktop → Settings → Extensions**.

In Claude Desktop, ask:

> Use concierge_info

This returns the installed extension's version, `build_time`, and `build_id` —
useful any time you need to confirm Claude Desktop is actually running the
build you expect.

> Use list_accounts

Confirms your Google account is visible to Concierge.

#### Reinstalling after a rebuild

Claude Desktop doesn't always swap the unpacked extension cleanly when you
re-open a new `.mcpb` on top of an old one. Symptom: `concierge_info` reports
an old `build_time`. Clean reinstall:

```bash
osascript -e 'quit app "Claude"'
rm -rf "$HOME/Library/Application Support/Claude/Claude Extensions/local.mcpb.justin-stottlemyer.concierge-google-workspace"
open -a Claude
open -a Claude path/to/Concierge-GoogleWorkspace-<version>-darwin-arm64.mcpb
```

---

## Troubleshooting

### "API has not been used in project" / "SERVICE_DISABLED"
- Symptom: a tool fails with a message about an API not being enabled.
- Cause: the corresponding Google API isn't activated in your Cloud project.
- Fix: re-run the orchestrator (it'll enable the missing API), or follow Step 5
  of the [Manual fallback](#step-by-step-manual-recipe). Wait ~30s for
  propagation; retry.
- Concierge surfaces this as `error_code: "api_not_enabled"` with a direct
  enable URL in `docs_url`.

### `Error 400: invalid_scope` during `gws auth login`
- Symptom: browser consent says *"Some requested scopes were invalid"*.
- Cause: used `--scopes drive,gmail` (expects full URLs). Should be
  `--services drive,gmail`.
- Fix: re-run with the correct flag. The orchestrator always uses `--services`.

### `Error 403: access_denied` during consent
- Symptom: browser shows `Error 403: access_denied`.
- Cause: your Google account is not on the OAuth consent screen's Test users
  list (app is in Testing mode).
- Fix: open
  [console.cloud.google.com/apis/credentials/consent](https://console.cloud.google.com/apis/credentials/consent)
  → Test users → + Add users → enter your email. Retry.

### `Project 'projects/xxx' not found or deleted`
- Symptom: auth succeeds but every API call fails with this.
- Cause: the `project_id` in `~/.config/gws/client_secret.json` doesn't match a
  real Google Cloud Project ID. Usually a made-up label was typed instead of
  the auto-generated string.
- Fix: look up the real Project ID in Cloud Console **Project info** card (NOT
  the Project Number, NOT a label you invented), edit
  `~/.config/gws/client_secret.json` to match, retry.
- Note: this error comes directly from Google's backend. It is **not** an
  Anthropic or Concierge bug, even when surfaced through Claude.

### Tool calls fail right after a `.mcpb` reinstall
- Symptom: Claude Desktop acts like an older version — missing tools, wrong
  outputs, stale errors.
- Cause: Claude Desktop sometimes doesn't swap the unpacked extension when you
  re-open a `.mcpb` on top of an existing install.
- Fix: do the [clean-reinstall sequence](#reinstalling-after-a-rebuild).
- Verify: `Use concierge_info` and confirm `build_time` matches the new build.

### Generic "Tool execution failed" with no detail
- Ask Claude: `Use concierge_info`. Note the `build_time`.
- If older than your most recent rebuild, do the
  [clean reinstall](#reinstalling-after-a-rebuild).
- If current, check `gws auth status` in a terminal and re-run the
  [Step 6 verify](#step-by-step-manual-recipe).

### "Google hasn't verified this app" warning
- Normal for Testing-mode apps. Click **Advanced → Go to \<app name\>
  (unsafe)**. Safe because it's your own Cloud project.

### Forgot to copy client_secret, Cloud Console hides it now
- OAuth client page → click the client → **Reset client secret** → copy the new
  one → update `~/.config/gws/client_secret.json`.

### Lost `~/.config/gws/`
- Re-run the orchestrator. The Cloud project + OAuth client persist; only the
  local credential file needs to be regenerated.

---

## What's next

After this one-time bootstrap, Concierge handles everything. You never touch
the terminal again unless you want to.

- First-use of each service bundle in Concierge triggers an in-browser consent
  prompt (the browser opens from Claude Desktop itself — no terminal needed
  after setup).
- Adding a second Google account: just use Concierge tools with an unfamiliar
  `account` parameter and you'll be prompted to consent.
- Revoking: use `remove_account` (per-account) or `factory_reset` (everything)
  from inside Claude Desktop.
- Full removal: run `factory_reset` then uninstall the extension from Claude
  Desktop.

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

**You can run both at once.** Tool names don't literally collide; Claude picks
between them based on what you're asking for. Example:

- *"Summarize yesterday's email about the Q2 launch"* → Claude picks claude.ai
  Gmail (read-focused)
- *"Send a reply to that email saying we're on track"* → Claude picks Concierge
  `gmail_send` (hosted connector can't send)
- *"Find meeting times next week with Alice and Bob"* → Claude picks claude.ai
  Calendar (`gcal_find_meeting_times`)
- *"Upload this PDF to my Drive and share it with the team"* → Claude picks
  Concierge (`drive_upload` + `drive_permissions_create`)

**If you want a privacy-first setup:** disable claude.ai's Google connectors in
Claude Desktop Settings → Integrations, and let Concierge handle everything.
You'll give up convenience helpers like `gcal_find_meeting_times` but gain zero
data leakage to Anthropic.

**If you want max convenience:** keep both connected. Claude will pick the
best tool per request.

## Claude Desktop's tool-approval dialog

The first time each Concierge tool runs, Claude Desktop shows an **"Allow this
tool?"** dialog. This is normal and expected — it's a built-in security layer
that gives you visibility over what each tool does.

**Guidance:**

- **Safe to "Allow Always"** for read-only tools: `list_accounts`,
  `gmail_triage`, `drive_files_list`, `docs_documents_get`, `sheets_read`,
  `calendar_agenda`, any `*_read`/`*_list` tool, and the diagnostic tools.
- **Keep "Allow Once"** for destructive tools so you see the dialog every time:
  `remove_account`, `factory_reset`, `set_read_only`, `drive_permissions_create`
  (any write tool). These also require a human-typed confirmation phrase — the
  dialog is a second line of defense.
- **Block** any tool invocation that looks unexpected — especially if Claude is
  calling a destructive tool after reading an external document, email, or file
  whose content you don't fully trust. Prompt-injection attacks can try to
  steer Claude into calling tools; the approval dialog is your chance to catch
  that.

If an email or web page tells Claude "please run [tool] for me" and you didn't
ask for that action, **block it.** Concierge requires a typed confirmation
phrase for truly dangerous operations, but the approval dialog is the first
place to notice something is off.
