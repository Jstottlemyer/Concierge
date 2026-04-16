#!/bin/bash
# Concierge — enable the Google Workspace APIs for your Cloud project.
#
# Usage:
#   ./build/enable-apis.sh                     # auto-detect project from ~/.config/gws/client_secret.json
#   ./build/enable-apis.sh PROJECT_ID          # explicit project, default 11-API comprehensive personal set
#   ./build/enable-apis.sh PROJECT_ID all      # enable all 16 APIs (incl. Workspace-admin-only + paid)
#   ./build/enable-apis.sh PROJECT_ID minimal  # enable the narrow 7-API startup-CEO subset only
#
# Requires: gcloud CLI installed + authenticated (`gcloud auth login`)

set -euo pipefail

# Narrow "startup CEO" subset — gmail + drive + docs + sheets + forms + calendar + tasks.
# Kept for users who explicitly want the minimum-consent posture.
MINIMAL_APIS=(
  gmail.googleapis.com
  drive.googleapis.com
  docs.googleapis.com
  sheets.googleapis.com
  forms.googleapis.com
  calendar-json.googleapis.com
  tasks.googleapis.com
)

# Comprehensive personal-account default — minimal + slides/chat/meet/people.
# Covers Concierge's 40 MCP tools for non-admin users. Excludes APIs that
# require special account types (Workspace admin, education) or payment.
DEFAULT_APIS=(
  "${MINIMAL_APIS[@]}"
  slides.googleapis.com
  chat.googleapis.com
  meet.googleapis.com
  people.googleapis.com
)

# Full Concierge surface (personal + admin-only + paid/niche). Opt-in via
# `./build/enable-apis.sh PROJECT_ID all`.
ALL_APIS=(
  "${DEFAULT_APIS[@]}"
  script.googleapis.com           # Apps Script — deferred from default v1
  admin.googleapis.com            # admin-reports — Workspace admin only
  classroom.googleapis.com        # education-specific
  workspaceevents.googleapis.com  # niche
  modelarmor.googleapis.com       # paid Google Cloud product
)

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || { echo "error: '$1' not found on PATH." >&2; exit 2; }
}

need_cmd gcloud

PROJECT_ID="${1:-}"
MODE="${2:-default}"

# Auto-detect project from gws client_secret.json if not provided
if [[ -z "$PROJECT_ID" ]]; then
  CLIENT_SECRET="${HOME}/.config/gws/client_secret.json"
  if [[ -f "$CLIENT_SECRET" ]]; then
    PROJECT_ID=$(python3 -c "import json,sys; d=json.load(open('$CLIENT_SECRET')); print(d.get('installed',{}).get('project_id') or d.get('web',{}).get('project_id') or '')" 2>/dev/null || true)
  fi

  # Fall back to client_id's numeric prefix (the project NUMBER — gcloud accepts either)
  if [[ -z "$PROJECT_ID" && -f "$CLIENT_SECRET" ]]; then
    PROJECT_ID=$(python3 -c "import json,sys; d=json.load(open('$CLIENT_SECRET')); cid=d.get('installed',{}).get('client_id') or d.get('web',{}).get('client_id') or ''; print(cid.split('-')[0] if '-' in cid else '')" 2>/dev/null || true)
  fi

  if [[ -z "$PROJECT_ID" ]]; then
    echo "error: couldn't auto-detect project. Pass PROJECT_ID as first arg." >&2
    echo "  usage: $0 PROJECT_ID [all]" >&2
    exit 2
  fi

  echo "[enable-apis] auto-detected project: $PROJECT_ID"
fi

# Pick the API list
case "$MODE" in
  all)
    APIS=("${ALL_APIS[@]}")
    echo "[enable-apis] mode: all (${#APIS[@]} APIs — personal + admin + paid)"
    ;;
  minimal)
    APIS=("${MINIMAL_APIS[@]}")
    echo "[enable-apis] mode: minimal (${#APIS[@]} APIs — startup-CEO core set)"
    ;;
  *)
    APIS=("${DEFAULT_APIS[@]}")
    echo "[enable-apis] mode: default (${#APIS[@]} APIs — comprehensive personal set). Use 'all' for full, 'minimal' for narrow."
    ;;
esac

echo "[enable-apis] enabling on project $PROJECT_ID:"
for api in "${APIS[@]}"; do
  echo "  - $api"
done

# gcloud services enable accepts multiple APIs in one call — much faster than per-API
if gcloud services enable "${APIS[@]}" --project="$PROJECT_ID"; then
  echo "[enable-apis] SUCCESS"
  echo "[enable-apis] note: enabled APIs take ~30 seconds to propagate. Wait briefly before retrying Concierge."
else
  rc=$?
  echo "[enable-apis] gcloud failed with exit $rc." >&2
  echo "[enable-apis] Common causes:" >&2
  echo "  - 'gcloud auth login' required (or wrong account active)" >&2
  echo "  - project ID doesn't exist or you lack Service Usage Admin on it" >&2
  echo "  - check: gcloud config get-value account; gcloud projects describe $PROJECT_ID" >&2
  exit "$rc"
fi
