#!/usr/bin/env bash
# build/verify-pack.sh — local integrity + Gatekeeper check for a packaged .mcpb
#
# Takes a .mcpb path (or auto-discovers one in the repo root) and validates
# the bundle end-to-end before any release or Claude Desktop install.
#
# Checks:
#   1. Unzip to a scratch dir
#   2. manifest.json parses + required fields present
#   3. bin/gws exists, is a Mach-O binary, is executable
#   4. codesign -dvv bin/gws (informational — ad-hoc expected)
#   5. spctl --assess --type execute bin/gws (informational — rejection is
#      expected per T0.3; Claude Desktop handles ad-hoc signing transparently
#      per the T0.1 spike finding)
#   6. sha256(bin/gws) matches build/gws-checksums.txt for this arch
#   7. LICENSE + LICENSE.gws present
#
# Exit 0 if all NON-informational checks pass. spctl rejection is reported as
# INFO, never a failure.
#
# Spec refs: plan.md T23, Decision #11, spikes.md T0.1 / T0.3.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# --- Resolve .mcpb path -------------------------------------------------------
MCPB_PATH="${1:-}"
# In the monorepo layout, pack.sh writes the .mcpb to the monorepo root (two
# dirs up from this script). Search there first, then fall back to REPO_ROOT
# (package dir) for manually-dropped artifacts.
MONOREPO_ROOT="$(cd "${REPO_ROOT}/../.." && pwd)"
if [[ -z "${MCPB_PATH}" ]]; then
  # Auto-discover: if exactly one .mcpb in monorepo root, use it. Avoid bash 4
  # mapfile since macOS ships bash 3.2 by default.
  CANDIDATES=()
  while IFS= read -r line; do
    CANDIDATES+=("${line}")
  done < <(ls -1 "${MONOREPO_ROOT}"/*.mcpb 2>/dev/null || true)
  if [[ ${#CANDIDATES[@]} -eq 0 ]]; then
    # Fallback: look in the package dir too.
    while IFS= read -r line; do
      CANDIDATES+=("${line}")
    done < <(ls -1 "${REPO_ROOT}"/*.mcpb 2>/dev/null || true)
  fi
  if [[ ${#CANDIDATES[@]} -eq 1 ]]; then
    MCPB_PATH="${CANDIDATES[0]}"
  else
    echo "usage: $0 <path-to-.mcpb>" >&2
    echo "       (or drop a single .mcpb into ${MONOREPO_ROOT} for auto-discovery)" >&2
    exit 2
  fi
fi

if [[ ! -f "${MCPB_PATH}" ]]; then
  echo "error: not a file: ${MCPB_PATH}" >&2
  exit 2
fi

echo "[verify] target: ${MCPB_PATH}"
SIZE_BYTES="$(stat -f '%z' "${MCPB_PATH}")"
SIZE_MB="$(awk -v b="${SIZE_BYTES}" 'BEGIN{printf "%.2f", b/1024/1024}')"
echo "[verify] size:   ${SIZE_MB} MB"

# --- Scratch dir cleanup ------------------------------------------------------
SCRATCH="$(mktemp -d -t concierge-verify.XXXXXX)"
trap 'rm -rf "${SCRATCH}"' EXIT

# Tracking: fail count vs info count.
FAILS=0
ok()   { echo "[verify]  OK   $*"; }
info() { echo "[verify] INFO  $*"; }
fail() { echo "[verify] FAIL  $*" >&2; FAILS=$((FAILS + 1)); }

# --- 1. Unzip -----------------------------------------------------------------
if ! unzip -q "${MCPB_PATH}" -d "${SCRATCH}/pkg"; then
  fail "unzip failed"
  exit 1
fi
ok "unzipped bundle"

PKG="${SCRATCH}/pkg"

# --- 2. manifest.json ---------------------------------------------------------
MANIFEST="${PKG}/manifest.json"
if [[ ! -f "${MANIFEST}" ]]; then
  fail "manifest.json missing"
else
  if ! node -e "JSON.parse(require('fs').readFileSync('${MANIFEST}','utf8'))" 2>/dev/null; then
    fail "manifest.json is not valid JSON"
  else
    # Required fields: manifest_version, name, version, server.type, server.entry_point
    MISSING="$(node -e "
      const m = JSON.parse(require('fs').readFileSync('${MANIFEST}','utf8'));
      const required = ['manifest_version','name','version'];
      const missing = required.filter(k => !m[k]);
      if (!m.server || !m.server.type || !m.server.entry_point) missing.push('server.{type,entry_point}');
      process.stdout.write(missing.join(','));
    ")"
    if [[ -n "${MISSING}" ]]; then
      fail "manifest.json missing required fields: ${MISSING}"
    else
      MVER="$(node -e "console.log(JSON.parse(require('fs').readFileSync('${MANIFEST}','utf8')).version)")"
      MNAME="$(node -e "console.log(JSON.parse(require('fs').readFileSync('${MANIFEST}','utf8')).name)")"
      ok "manifest.json valid (name=${MNAME} version=${MVER})"
    fi
  fi
fi

# --- 3. bin/gws existence / Mach-O / executable ------------------------------
GWS="${PKG}/bin/gws"
if [[ ! -f "${GWS}" ]]; then
  fail "bin/gws missing"
else
  if [[ ! -x "${GWS}" ]]; then
    fail "bin/gws is not executable"
  else
    ok "bin/gws exists + executable"
  fi
  FILE_OUT="$(file "${GWS}")"
  if echo "${FILE_OUT}" | grep -q "Mach-O"; then
    ok "bin/gws is Mach-O (${FILE_OUT#*: })"
  else
    fail "bin/gws is not a Mach-O binary: ${FILE_OUT}"
  fi
fi

# --- 4. codesign (informational) ---------------------------------------------
if [[ -f "${GWS}" ]]; then
  CODESIGN_OUT="$(codesign -dvv "${GWS}" 2>&1 || true)"
  # Truncate to first 8 lines for readable output.
  CODESIGN_BRIEF="$(echo "${CODESIGN_OUT}" | head -n 8)"
  info "codesign -dvv bin/gws:"
  echo "${CODESIGN_BRIEF}" | sed 's/^/         /'
  if echo "${CODESIGN_OUT}" | grep -q "Signature=adhoc"; then
    info "adhoc signature detected (expected per T0.3)"
  fi
fi

# --- 5. spctl (informational) -------------------------------------------------
if [[ -f "${GWS}" ]]; then
  SPCTL_OUT="$(spctl --assess --type execute "${GWS}" 2>&1 || true)"
  info "spctl --assess --type execute bin/gws: ${SPCTL_OUT}"
  if echo "${SPCTL_OUT}" | grep -qi "rejected"; then
    info "spctl rejection is EXPECTED for ad-hoc signed binaries."
    info "Claude Desktop handles .mcpb-bundled binaries transparently (per T0.1 spike)."
  fi
fi

# --- 6. sha256 check vs checksum file ----------------------------------------
if [[ -f "${GWS}" ]]; then
  ACTUAL_SHA="$(shasum -a 256 "${GWS}" | awk '{print $1}')"
  # Infer arch from the filename, then fall back to matching sha.
  ARCH_FROM_NAME="$(basename "${MCPB_PATH}" | sed -nE 's/.*-(darwin-(arm64|x64))\.mcpb$/\1/p')"
  CHECKSUM_FILE="${REPO_ROOT}/build/gws-checksums.txt"
  if [[ -n "${ARCH_FROM_NAME}" && -f "${CHECKSUM_FILE}" ]]; then
    EXPECTED_SHA="$(grep -E "^[0-9a-f]{64}[[:space:]]+${ARCH_FROM_NAME}[[:space:]]+v" "${CHECKSUM_FILE}" | head -n1 | awk '{print $1}' || true)"
    if [[ -z "${EXPECTED_SHA}" ]]; then
      fail "no pinned sha for ${ARCH_FROM_NAME} in build/gws-checksums.txt"
    elif [[ "${ACTUAL_SHA}" == "${EXPECTED_SHA}" ]]; then
      ok "bin/gws sha256 matches pinned checksum (${ARCH_FROM_NAME})"
    else
      fail "bin/gws sha256 mismatch (arch=${ARCH_FROM_NAME}): expected=${EXPECTED_SHA} actual=${ACTUAL_SHA}"
    fi
  else
    # Fallback: any sha line matching.
    if grep -qE "^${ACTUAL_SHA}[[:space:]]" "${CHECKSUM_FILE}" 2>/dev/null; then
      ok "bin/gws sha256 matches a pinned line (arch unknown from filename)"
    else
      fail "cannot map ${MCPB_PATH} to an arch — filename must match Concierge-GoogleWorkspace-<ver>-darwin-(arm64|x64).mcpb"
    fi
  fi
fi

# --- 7. LICENSE + LICENSE.gws -------------------------------------------------
if [[ -f "${PKG}/LICENSE" ]]; then
  ok "LICENSE present"
else
  fail "LICENSE missing from bundle"
fi
if [[ -f "${PKG}/LICENSE.gws" ]]; then
  ok "LICENSE.gws present"
else
  fail "LICENSE.gws missing from bundle"
fi
if [[ -f "${PKG}/NOTICE.gws" ]]; then
  ok "NOTICE.gws present"
else
  info "NOTICE.gws absent (not strictly required but recommended)"
fi

# --- Summary ------------------------------------------------------------------
echo ""
if [[ ${FAILS} -eq 0 ]]; then
  echo "[verify] RESULT: PASS — all integrity checks succeeded."
  echo "[verify]         (spctl rejection above is informational, not a failure.)"
  exit 0
else
  echo "[verify] RESULT: FAIL — ${FAILS} integrity check(s) failed."
  exit 1
fi
