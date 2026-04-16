#!/bin/bash
# setup.sh — Concierge one-shot onboarding for macOS.
#
# Walks through onboarding Steps 1-6, skipping anything already done:
#   1. Homebrew                                        (auto)
#   2. gws CLI (googleworkspace-cli formula)           (auto)
#   3. gcloud CLI + login                              (auto; optional but recommended)
#   4. Cloud project + OAuth client + client_secret.json  (auto via `gws auth setup`
#                                                          if gcloud present; else prints
#                                                          Cloud Console URL + waits)
#   5. gws auth login                                  (auto)
#   6. Enable Google APIs                              (auto via enable-apis.sh)
#   7. Verify: gws auth status                         (auto)
#   8. Install .mcpb into Claude Desktop               (only if .mcpb path passed)
#
# Usage:
#   bash scripts/setup.sh                          # full walkthrough
#   bash scripts/setup.sh path/to/Concierge-*.mcpb # + Step 8
#
# Remote one-liner (new machines):
#   curl -fsSL https://raw.githubusercontent.com/Jstottlemyer/Concierge/main/scripts/setup.sh | bash
#
# Safe to re-run. Interactive — prompts before any destructive action.

set -euo pipefail

readonly SCRIPT_NAME="setup.sh"
readonly SERVICES="gmail,sheets,docs,drive,forms,calendar,tasks"
readonly ENABLE_APIS_SCRIPT="packages/google-workspace/build/enable-apis.sh"

MCPB_PATH="${1:-}"

log()    { printf '[%s] %s\n' "$SCRIPT_NAME" "$*"; }
warn()   { printf '[%s] ⚠  %s\n' "$SCRIPT_NAME" "$*" >&2; }
die()    { printf '[%s] ✖  %s\n' "$SCRIPT_NAME" "$*" >&2; exit 1; }
lc() {
  # Lowercase a string — POSIX alternative to bash 4's ${var,,} which
  # macOS's default bash 3.2 doesn't support.
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

ask_yn() {
  # ask_yn "prompt"  → returns 0 for yes, 1 for no
  local prompt="$1" answer
  printf '[%s] %s [y/N] ' "$SCRIPT_NAME" "$prompt" >&2
  read -r answer
  local answer_lc
  answer_lc="$(lc "$answer")"
  [[ "$answer_lc" == "y" || "$answer_lc" == "yes" ]]
}

print_manual_cloud_console_steps() {
  cat >&2 <<'EOM'

  ═════════════════════════════════════════════════════════════════════════
  MANUAL ROUTE — Cloud Console browser flow
  ═════════════════════════════════════════════════════════════════════════

  1. Open the Google Cloud Console:
       https://console.cloud.google.com/

  2. Create a new project (top-left dropdown → "New Project").
     Name: anything you'll recognize (e.g., "concierge-gws").

  3. Configure the OAuth consent screen:
       https://console.cloud.google.com/apis/credentials/consent
     - User type: "External"
     - App name, support email, developer contact: fill in
     - Publishing status: leave as "Testing"
     - Add your own email as a Test User

  4. Create an OAuth client:
       https://console.cloud.google.com/apis/credentials
     - Click "+ CREATE CREDENTIALS" → "OAuth client ID"
     - Application type: "Desktop app"
     - Name: "Concierge"
     - Click CREATE → DOWNLOAD JSON (save the file)

  5. Place the downloaded JSON at the path gws expects:
       mkdir -p ~/.config/gws
       mv ~/Downloads/client_secret_*.json ~/.config/gws/client_secret.json

  6. Come back and re-run this script:
       bash scripts/setup.sh
     It will detect the client_secret.json and continue from Step 5
     (gws auth login).

  Full walkthrough with screenshots: docs/setup/user-onboarding.md Step 2
  ═════════════════════════════════════════════════════════════════════════

EOM
}

# ── 0. Platform guard ──────────────────────────────────────────────────────

if [[ "$(uname -s)" != "Darwin" ]]; then
  die "macOS only for v1. (uname -s=$(uname -s))"
fi

log "Concierge onboarding — Steps 1-8 (skips anything already done)."
echo ""

# ── 1. Homebrew ────────────────────────────────────────────────────────────

if command -v brew >/dev/null 2>&1; then
  log "[1/7] Homebrew already installed: $(brew --version | head -1)"
else
  log "[1/7] Homebrew not found. Installing from brew.sh..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if   [[ -x /opt/homebrew/bin/brew ]]; then eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew   ]]; then eval "$(/usr/local/bin/brew shellenv)"
  else die "Homebrew installer finished but brew not found at standard paths."
  fi
  log "      Homebrew ready: $(brew --version | head -1)"
  warn "      To make brew persist in new shells, add to ~/.zshrc:"
  warn '           eval "$('"$(command -v brew)"' shellenv)"'
fi

# ── 2. gws ─────────────────────────────────────────────────────────────────

if command -v gws >/dev/null 2>&1; then
  log "[2/7] gws already installed: $(gws --version 2>&1 | head -1)"
else
  log "[2/7] Installing googleworkspace-cli (gws) via Homebrew..."
  brew install googleworkspace-cli
  log "      gws ready: $(gws --version 2>&1 | head -1)"
fi

# ── 3. gcloud (optional but dramatically shortens Step 4) ─────────────────

if command -v gcloud >/dev/null 2>&1; then
  log "[3/7] gcloud already installed: $(gcloud --version 2>&1 | head -1)"
  if gcloud auth print-access-token >/dev/null 2>&1; then
    log "      gcloud is authenticated."
  else
    log "      gcloud installed but not authenticated."
    if ask_yn "Run 'gcloud auth login' now?"; then
      gcloud auth login
    fi
  fi
else
  log "[3/7] gcloud not installed."
  cat >&2 <<'EOM'

  Step 4 creates a Google Cloud project and an OAuth client. Two paths:

  (a) AUTOMATED — install gcloud now (~1 min brew install + auth login)
      Then 'gws auth setup' walks through project / consent screen / OAuth
      client / client_secret.json download in one interactive command.

  (b) MANUAL — skip gcloud, do the Cloud Console clicks yourself
      ~10 min browser flow. Script prints exact URLs + instructions, then
      exits. Re-run once client_secret.json is in place.

EOM
  printf '[%s] Pick a path: (a) install gcloud, (b) manual browser flow, (q) quit [a/b/q] ' "$SCRIPT_NAME" >&2
  read -r gcloud_choice
  case "$(lc "$gcloud_choice")" in
    a|auto|automated|yes|y)
      log "      Installing google-cloud-sdk via Homebrew..."
      brew install --cask google-cloud-sdk
      log "      Running 'gcloud auth login' (browser will open)..."
      gcloud auth login
      ;;
    b|manual)
      print_manual_cloud_console_steps
      exit 0
      ;;
    q|quit|"")
      warn "      aborted. Re-run when ready."
      exit 0
      ;;
    *)
      warn "      unrecognized response '$gcloud_choice'; treating as quit."
      exit 0
      ;;
  esac
fi

# ── 4. Cloud project + OAuth client + client_secret.json ──────────────────

CLIENT_SECRET="${HOME}/.config/gws/client_secret.json"

if [[ -f "$CLIENT_SECRET" ]]; then
  log "[4/7] client_secret.json already present at $CLIENT_SECRET"
else
  log "[4/7] No client_secret.json yet."
  if command -v gcloud >/dev/null 2>&1 && gcloud auth print-access-token >/dev/null 2>&1; then
    warn "      With gcloud authenticated, 'gws auth setup' walks through:"
    warn "         project creation → OAuth consent screen → OAuth client → JSON download"
    if ask_yn "Run 'gws auth setup' now?"; then
      gws auth setup || die "gws auth setup failed. See docs/setup/user-onboarding.md Step 2 for manual recovery."
    else
      warn "      Skipping — see docs/setup/user-onboarding.md Step 2 for manual Cloud Console flow."
      warn "      Re-run this script once ~/.config/gws/client_secret.json exists."
      exit 0
    fi
  else
    warn "      Without gcloud authenticated, this step is a browser flow."
    print_manual_cloud_console_steps
    exit 0
  fi
fi

# ── 5. gws auth login ──────────────────────────────────────────────────────

if gws auth status >/dev/null 2>&1; then
  log "[5/7] gws already authenticated: $(gws auth status 2>&1 | head -1 || true)"
else
  log "[5/7] Running gws auth login (browser will open for OAuth consent)..."
  gws auth login --services "$SERVICES" || die "gws auth login failed. Check browser for error."
  log "      auth complete."
fi

# ── 6. Enable Google APIs ──────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ -x "$REPO_ROOT/$ENABLE_APIS_SCRIPT" ]] && command -v gcloud >/dev/null 2>&1; then
  log "[6/7] Enabling Google APIs on your Cloud project..."
  (cd "$REPO_ROOT" && bash "$ENABLE_APIS_SCRIPT") || warn "enable-apis.sh failed — you may need to enable manually in the Cloud Console."
else
  warn "[6/7] Skipping API enablement:"
  [[ ! -x "$REPO_ROOT/$ENABLE_APIS_SCRIPT" ]] && warn "       (enable-apis.sh not found at $ENABLE_APIS_SCRIPT — running from curl-pipe?)"
  command -v gcloud >/dev/null 2>&1 || warn "       (gcloud not installed — see step 3)"
  warn "      Manually enable these APIs in the Cloud Console:"
  warn "         gmail, drive, docs, sheets, forms, calendar-json, tasks"
fi

# ── 7. Verify ──────────────────────────────────────────────────────────────

log "[7/7] Verifying auth + APIs..."
gws auth status || die "gws auth status failed post-setup. Something went wrong."
log "      verification ok."

# ── 8. Optional: install .mcpb into Claude Desktop ────────────────────────

if [[ -n "$MCPB_PATH" ]]; then
  if [[ ! -f "$MCPB_PATH" ]]; then
    die "No file at '$MCPB_PATH' — can't install into Claude Desktop."
  fi
  log "[8/8] Installing $MCPB_PATH into Claude Desktop..."
  open -a "Claude" "$MCPB_PATH" 2>/dev/null || warn "could not auto-open Claude; drag $MCPB_PATH into Claude Desktop → Settings → Extensions."
  log "      done."
fi

# ── Done ───────────────────────────────────────────────────────────────────

cat <<'EOM'

──────────────────────────────────────────────────────────────────────────────
Setup complete. Ask Claude: "Use concierge_info" or "Use list_accounts"
to confirm the extension is wired up correctly.

Full onboarding doc: docs/setup/user-onboarding.md
Troubleshooting:     docs/troubleshooting.md
──────────────────────────────────────────────────────────────────────────────
EOM
