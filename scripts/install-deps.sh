#!/bin/bash
# install-deps.sh — Concierge prerequisites (macOS).
#
# Ensures Homebrew + the googleworkspace/cli (`gws`) are installed. Run this
# once before the rest of the user-onboarding flow (Steps 2 through 6 of
# docs/setup/user-onboarding.md).
#
# Usage:
#   bash scripts/install-deps.sh
# Or:
#   curl -fsSL https://raw.githubusercontent.com/Jstottlemyer/Concierge/main/scripts/install-deps.sh | bash
#
# Exit codes:
#   0 — prerequisites present (either already were, or were just installed)
#   1 — unsupported platform or non-recoverable failure

set -euo pipefail

readonly SCRIPT_NAME="install-deps.sh"

log()  { printf '[%s] %s\n' "$SCRIPT_NAME" "$*"; }
warn() { printf '[%s] ⚠  %s\n' "$SCRIPT_NAME" "$*" >&2; }
die()  { printf '[%s] ✖  %s\n' "$SCRIPT_NAME" "$*" >&2; exit 1; }

# ── 1. Platform guard ───────────────────────────────────────────────────────

if [[ "$(uname -s)" != "Darwin" ]]; then
  die "macOS only for v1. (uname -s=$(uname -s))"
fi

# ── 2. Homebrew ─────────────────────────────────────────────────────────────

if command -v brew >/dev/null 2>&1; then
  log "Homebrew already installed: $(brew --version | head -1)"
else
  log "Homebrew not found. Installing from brew.sh..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

  # Add brew to PATH for the rest of THIS shell session. The Homebrew
  # installer prints instructions for the user's shell rc but doesn't
  # source them, so fresh shells wouldn't find brew until re-login. This
  # line handles the current session so the gws install below works.
  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"                # Apple Silicon
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"                   # Intel
  else
    die "Homebrew installer finished but brew not found at standard paths."
  fi

  log "Homebrew ready: $(brew --version | head -1)"
  warn "To make brew persist in new shells, add this to ~/.zshrc (or ~/.bashrc):"
  warn '    eval "$('"$(command -v brew)"' shellenv)"'
fi

# ── 3. gws (googleworkspace/cli) ────────────────────────────────────────────

if command -v gws >/dev/null 2>&1; then
  log "gws already installed: $(gws --version)"
else
  log "Installing googleworkspace-cli (gws) via Homebrew..."
  brew install googleworkspace-cli
  log "gws ready: $(gws --version)"
fi

# ── 4. Next-steps pointer ───────────────────────────────────────────────────

cat <<'EOM'

──────────────────────────────────────────────────────────────────────────────
Prerequisites installed. Continue with the user-onboarding flow:

  Step 2  Create a Google Cloud project + OAuth client
  Step 3  Place client_secret.json at ~/.config/gws/client_secret.json
  Step 4  gws auth login --services gmail,sheets,docs,drive,forms
  Step 4.5 Enable Google APIs for the Cloud project
  Step 5  Verify: gws auth status
  Step 6  Install Concierge .mcpb into Claude Desktop

Full walkthrough: docs/setup/user-onboarding.md
──────────────────────────────────────────────────────────────────────────────
EOM
