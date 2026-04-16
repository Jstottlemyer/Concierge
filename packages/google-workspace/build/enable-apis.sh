#!/bin/bash
# Concierge — enable the Google Workspace APIs for your Cloud project.
#
# Usage:
#   ./build/enable-apis.sh                 # auto-detect project from ~/.config/gws/client_secret.json
#   ./build/enable-apis.sh PROJECT_ID      # explicit project, default is 12 for personal-account set
#   ./build/enable-apis.sh PROJECT_ID all  # enable all 16 APIs (incl. admin / classroom / modelarmor / events)
#
# Requires: gcloud CLI installed + authenticated (`gcloud auth login`)

set -euo pipefail

# Default APIs for a personal Google account — the four user-facing bundles
# (Productivity + Collaboration + Creator + Automation). Excludes admin /
# classroom / modelarmor / events (opt in via second arg "all").
DEFAULT_APIS=(
  gmail.googleapis.com
  sheets.googleapis.com
  docs.googleapis.com
  drive.googleapis.com
  forms.googleapis.com
  calendar-json.googleapis.com
  tasks.googleapis.com
  slides.googleapis.com
  chat.googleapis.com
  meet.googleapis.com
  people.googleapis.com
  script.googleapis.com
)

# Full Concierge surface (adds Workspace-admin-only + paid/niche on top of
# DEFAULT_APIS). Opt-in via `./build/enable-apis.sh PROJECT_ID all`.
ALL_APIS=(
  "${DEFAULT_APIS[@]}"
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
if [[ "$MODE" == "all" ]]; then
  APIS=("${ALL_APIS[@]}")
  echo "[enable-apis] mode: all (${#APIS[@]} APIs)"
else
  APIS=("${DEFAULT_APIS[@]}")
  echo "[enable-apis] mode: default/personal-account (${#APIS[@]} APIs). Use 'all' as second arg for admin/classroom/modelarmor."
fi

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
