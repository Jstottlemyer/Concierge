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
readonly SERVICES="gmail,sheets,docs,drive,forms,calendar,tasks,slides,chat,meet,people"
readonly REPO_SLUG="Jstottlemyer/Concierge"
readonly ENABLE_APIS_SCRIPT="packages/google-workspace/build/enable-apis.sh"
readonly ENABLE_APIS_RAW_URL="https://raw.githubusercontent.com/${REPO_SLUG}/main/${ENABLE_APIS_SCRIPT}"

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

# (The opinionated flow assumes gcloud; the old "manual Cloud Console" branch
# was dropped 2026-04-16 to reduce decision fatigue. Users who genuinely want
# the browser route can follow docs/setup/user-onboarding.md Step 2 manually.)

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
  log "[3/7] gcloud not installed — needed for the automated project + OAuth flow."
  log "      Will install google-cloud-sdk via Homebrew (~1 min) then run 'gcloud auth login'."
  if ! ask_yn "Proceed?"; then
    warn "      aborted. Re-run when ready."
    exit 0
  fi
  log "      Installing google-cloud-sdk via Homebrew..."
  brew install --cask google-cloud-sdk
  log "      Running 'gcloud auth login' (browser will open)..."
  gcloud auth login
fi

# ── 4. Cloud project + OAuth client + client_secret.json ──────────────────

CLIENT_SECRET="${HOME}/.config/gws/client_secret.json"

if [[ -f "$CLIENT_SECRET" ]]; then
  log "[4/7] client_secret.json already present at $CLIENT_SECRET"
else
  log "[4/7] No client_secret.json — running 'gws auth setup' to create project + OAuth client."
  if ! command -v gcloud >/dev/null 2>&1 || ! gcloud auth print-access-token >/dev/null 2>&1; then
    die "      gcloud isn't installed or authenticated; Step 3 should have handled this. Re-run the script."
  fi
  gws auth setup || die "gws auth setup failed. See docs/setup/user-onboarding.md Step 2 for manual recovery."
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

if ! command -v gcloud >/dev/null 2>&1; then
  warn "[6/7] Skipping API enablement: gcloud not installed (see Step 3)."
  warn "      Manually enable these APIs in the Cloud Console:"
  warn "         gmail, drive, docs, sheets, forms, calendar-json, tasks"
elif [[ -x "$REPO_ROOT/$ENABLE_APIS_SCRIPT" ]]; then
  # Cloned-repo mode: run the local copy.
  log "[6/7] Enabling Google APIs on your Cloud project..."
  (cd "$REPO_ROOT" && bash "$ENABLE_APIS_SCRIPT") \
    || warn "enable-apis.sh failed — you may need to enable manually in the Cloud Console."
else
  # Curl-pipe mode (no local repo): fetch enable-apis.sh from the public repo.
  log "[6/7] Enabling Google APIs (fetching helper from GitHub raw)..."
  TMP_ENABLE="$(mktemp)"
  if curl -fsSL "$ENABLE_APIS_RAW_URL" -o "$TMP_ENABLE" 2>/dev/null && [[ -s "$TMP_ENABLE" ]]; then
    bash "$TMP_ENABLE" \
      || warn "enable-apis.sh failed — you may need to enable manually in the Cloud Console."
    rm -f "$TMP_ENABLE"
  else
    rm -f "$TMP_ENABLE"
    warn "      Could not fetch enable-apis.sh (repo may be private, or no network)."
    warn "      Manually enable these APIs in the Cloud Console:"
    warn "         gmail, drive, docs, sheets, forms, calendar-json, tasks"
  fi
fi

# ── 7. Verify ──────────────────────────────────────────────────────────────

log "[7/7] Verifying auth + APIs..."
gws auth status || die "gws auth status failed post-setup. Something went wrong."
log "      verification ok."

# ── 8. Install .mcpb into Claude Desktop ──────────────────────────────────
#
# Resolution order:
#   1. Explicit path passed as $1 (highest priority)
#   2. Auto-detect: repo root → ~/Downloads → ~/Desktop
#   3. Auto-download: latest signed + notarized release from GitHub
#
# Step 3 requires the repo to be PUBLIC. On a private repo the GitHub API
# returns 404 unauth, and we fall back to printing where to get the file.

readonly GH_API="https://api.github.com/repos/${REPO_SLUG}"

# 8a. Auto-detect locally if no explicit path
if [[ -z "$MCPB_PATH" ]]; then
  for candidate in \
    "$REPO_ROOT"/Concierge-GoogleWorkspace-*-darwin-arm64.mcpb \
    "$HOME/Downloads"/Concierge-GoogleWorkspace-*-darwin-arm64.mcpb \
    "$HOME/Desktop"/Concierge-GoogleWorkspace-*-darwin-arm64.mcpb
  do
    if [[ -f "$candidate" ]]; then
      MCPB_PATH="$candidate"
      log "[8/8] Found local .mcpb: $MCPB_PATH"
      break
    fi
  done
fi

# 8b. Auto-download from GitHub Releases if still nothing
if [[ -z "$MCPB_PATH" ]]; then
  log "[8/8] No local .mcpb; fetching latest from GitHub Releases..."
  LATEST_JSON="$(curl -fsSL "${GH_API}/releases/latest" 2>/dev/null || true)"
  if [[ -z "$LATEST_JSON" || "$LATEST_JSON" == *'"message": "Not Found"'* ]]; then
    warn "      GitHub API returned nothing (repo is private or no public release yet)."
    warn "      Obtain the .mcpb from the repo owner, drop it in ~/Downloads, and re-run."
    exit 0
  fi
  DOWNLOAD_URL="$(printf '%s' "$LATEST_JSON" \
    | grep -Eo '"browser_download_url":[[:space:]]*"[^"]*darwin-arm64\.mcpb"' \
    | head -1 \
    | cut -d'"' -f4 \
    || true)"
  if [[ -z "$DOWNLOAD_URL" ]]; then
    warn "      Latest release has no darwin-arm64 .mcpb asset (possibly a release-in-progress)."
    exit 0
  fi
  MCPB_FILENAME="$(basename "$DOWNLOAD_URL")"
  MCPB_PATH="$HOME/Downloads/$MCPB_FILENAME"
  log "      Downloading: $DOWNLOAD_URL"
  curl -fsSL -o "$MCPB_PATH" "$DOWNLOAD_URL"
  log "      Saved to $MCPB_PATH"

  # Best-effort SLSA attestation check if gh CLI is available.
  # Silent skip if gh isn't installed — it's an optional defense-in-depth.
  if command -v gh >/dev/null 2>&1; then
    if gh attestation verify "$MCPB_PATH" --repo "$REPO_SLUG" >/dev/null 2>&1; then
      log "      SLSA attestation: ✓ verified"
    else
      warn "      SLSA attestation verify failed. File may be tampered, or attestation not yet published. Proceed with caution."
    fi
  fi
fi

# 8c. Install into Claude Desktop
if [[ -n "$MCPB_PATH" && -f "$MCPB_PATH" ]]; then
  log "      Ready to install: $MCPB_PATH"
  if ask_yn "      Open in Claude Desktop now?"; then
    open -a "Claude" "$MCPB_PATH" 2>/dev/null \
      || warn "could not auto-open Claude; drag $MCPB_PATH into Claude Desktop → Settings → Extensions."
    log "      install initiated. Follow Claude Desktop's prompts to enable the extension."
  fi
elif [[ -n "$MCPB_PATH" ]]; then
  warn "[8/8] You passed '$MCPB_PATH' but that file doesn't exist. Skipping install."
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
