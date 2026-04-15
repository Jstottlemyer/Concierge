#!/usr/bin/env bash
# build/pack.sh — local .mcpb packager (mirrors .github/workflows/package-mcpb.yml)
#
# Produces a darwin-arm64 OR darwin-x64 .mcpb on the current Mac, without
# requiring a git push + tag. Used for local smoke tests, Gatekeeper checks
# (T23), and dev iteration before cutting a release.
#
# Flow:
#   1. Detect arch via uname -m -> darwin-arm64 | darwin-x64
#   2. Read pinned version + sha from build/gws-checksums.txt
#   3. Download google-workspace-cli-<asset-arch>-apple-darwin.tar.gz
#   4. Extract + sha256-verify the gws binary (hard fail on mismatch)
#   5. `pnpm install --frozen-lockfile && pnpm build` if dist/ missing
#   6. Stage .mcpb-staging/ with manifest, dist/, bin/gws, LICENSE,
#      LICENSE.gws, NOTICE.gws (synthesize if upstream lacks one)
#   7. Zip to Concierge-<version>-<arch>.mcpb at repo root
#   8. Clean staging dir; print artifact path
#
# Spec refs: plan.md T23, Decision #11 (binary integrity).
set -euo pipefail

# --- Locate repo root ---------------------------------------------------------
# This script lives at <repo>/build/pack.sh. Resolve repo root from its own
# path so the script works regardless of pwd.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

# --- Temp dir cleanup on exit -------------------------------------------------
TMPDIR_WORK="$(mktemp -d -t concierge-pack.XXXXXX)"
cleanup() {
  rm -rf "${TMPDIR_WORK}"
  # Never leave .mcpb-staging lying around — it's large and gitignored.
  rm -rf "${REPO_ROOT}/.mcpb-staging"
}
trap cleanup EXIT

# --- 1. Detect arch -----------------------------------------------------------
UNAME_M="$(uname -m)"
case "${UNAME_M}" in
  arm64|aarch64)
    ARCH="darwin-arm64"
    ASSET_ARCH="aarch64"
    ;;
  x86_64)
    ARCH="darwin-x64"
    ASSET_ARCH="x86_64"
    ;;
  *)
    echo "error: unsupported architecture: ${UNAME_M}" >&2
    exit 1
    ;;
esac
ASSET="google-workspace-cli-${ASSET_ARCH}-apple-darwin.tar.gz"
echo "[pack] arch=${ARCH} (uname -m=${UNAME_M}) asset=${ASSET}"

# --- 2. Read pinned version + sha ---------------------------------------------
CHECKSUM_FILE="${REPO_ROOT}/build/gws-checksums.txt"
if [[ ! -f "${CHECKSUM_FILE}" ]]; then
  echo "error: ${CHECKSUM_FILE} not found" >&2
  exit 1
fi
PIN_LINE="$(grep -E "^[0-9a-f]{64}[[:space:]]+${ARCH}[[:space:]]+v" "${CHECKSUM_FILE}" | head -n1 || true)"
if [[ -z "${PIN_LINE}" ]]; then
  echo "error: no pinned sha for ${ARCH} in ${CHECKSUM_FILE}" >&2
  exit 1
fi
EXPECTED_SHA="$(echo "${PIN_LINE}" | awk '{print $1}')"
GWS_VERSION="$(echo "${PIN_LINE}" | awk '{print $3}')"
echo "[pack] pinned gws=${GWS_VERSION} sha256=${EXPECTED_SHA}"

# --- 3. Download tarball ------------------------------------------------------
TARBALL_URL="https://github.com/googleworkspace/cli/releases/download/${GWS_VERSION}/${ASSET}"
TARBALL_PATH="${TMPDIR_WORK}/${ASSET}"
echo "[pack] downloading ${TARBALL_URL}"
curl -fsSL -o "${TARBALL_PATH}" "${TARBALL_URL}"

# --- 4. Extract + verify sha --------------------------------------------------
EXTRACT_DIR="${TMPDIR_WORK}/extract"
mkdir -p "${EXTRACT_DIR}"
tar -xzf "${TARBALL_PATH}" -C "${EXTRACT_DIR}"
GWS_BIN="$(find "${EXTRACT_DIR}" -maxdepth 3 -type f -name gws | head -n1)"
if [[ -z "${GWS_BIN}" ]]; then
  echo "error: could not find gws binary in extracted tarball" >&2
  exit 1
fi
ACTUAL_SHA="$(shasum -a 256 "${GWS_BIN}" | awk '{print $1}')"
if [[ "${ACTUAL_SHA}" != "${EXPECTED_SHA}" ]]; then
  echo "error: sha256 mismatch for gws:" >&2
  echo "  expected: ${EXPECTED_SHA}" >&2
  echo "  actual:   ${ACTUAL_SHA}" >&2
  exit 1
fi
echo "[pack] gws sha256 verified"

# Upstream LICENSE inside tarball -> staged as LICENSE.gws
UPSTREAM_LICENSE=""
if [[ -f "${EXTRACT_DIR}/LICENSE" ]]; then
  UPSTREAM_LICENSE="${EXTRACT_DIR}/LICENSE"
fi

# --- 5. Ensure dist/ is built -------------------------------------------------
# `REPO_ROOT` here is the package dir (packages/google-workspace). The
# monorepo root is two levels up; install runs at the monorepo root so
# @concierge/core resolves via pnpm-workspace.yaml.
MONOREPO_ROOT_FOR_INSTALL="$(cd "${REPO_ROOT}/../.." && pwd)"
if [[ ! -d "${REPO_ROOT}/dist" ]] || [[ -z "$(ls -A "${REPO_ROOT}/dist" 2>/dev/null || true)" ]]; then
  echo "[pack] dist/ missing — running pnpm install (workspace root) + build"
  (cd "${MONOREPO_ROOT_FOR_INSTALL}" && pnpm install --frozen-lockfile)
  (cd "${MONOREPO_ROOT_FOR_INSTALL}" && pnpm --filter @concierge/google-workspace build)
else
  echo "[pack] dist/ present — skipping rebuild"
fi

# --- 6. Read version from package.json ----------------------------------------
VERSION="$(node -e "console.log(JSON.parse(require('fs').readFileSync('${REPO_ROOT}/package.json','utf8')).version)")"
echo "[pack] package version=${VERSION}"

# --- 7. Assemble staging dir --------------------------------------------------
STAGE="${REPO_ROOT}/.mcpb-staging"
rm -rf "${STAGE}"
mkdir -p "${STAGE}/bin"
cp "${REPO_ROOT}/manifest.json" "${STAGE}/"
cp -R "${REPO_ROOT}/dist" "${STAGE}/dist"
cp "${GWS_BIN}" "${STAGE}/bin/gws"
chmod +x "${STAGE}/bin/gws"

if [[ -f "${REPO_ROOT}/LICENSE" ]]; then
  cp "${REPO_ROOT}/LICENSE" "${STAGE}/LICENSE"
fi

# Upstream gws LICENSE -> LICENSE.gws (Apache-2.0 per upstream)
if [[ -n "${UPSTREAM_LICENSE}" ]]; then
  cp "${UPSTREAM_LICENSE}" "${STAGE}/LICENSE.gws"
else
  echo "[pack] warning: upstream tarball has no LICENSE — staging a minimal pointer" >&2
  cat >"${STAGE}/LICENSE.gws" <<'EOF'
The bundled `bin/gws` binary is distributed under the Apache License 2.0.
Source: https://github.com/googleworkspace/cli
See the upstream repository for the full license text.
EOF
fi

# Upstream tarballs currently do not ship a NOTICE — synthesize a minimal one.
NOTICE_SRC="$(find "${EXTRACT_DIR}" -maxdepth 3 -type f -iname 'NOTICE*' | head -n1 || true)"
if [[ -n "${NOTICE_SRC}" ]]; then
  cp "${NOTICE_SRC}" "${STAGE}/NOTICE.gws"
else
  cat >"${STAGE}/NOTICE.gws" <<EOF
Concierge bundles the \`gws\` binary from googleworkspace/cli (${GWS_VERSION}).

This product includes software developed by Google LLC and contributors to
the googleworkspace/cli project, licensed under the Apache License, Version 2.0.

Upstream project: https://github.com/googleworkspace/cli
Upstream license: LICENSE.gws in this bundle (Apache-2.0).
EOF
fi

# As of the monorepo cut, tsup bundles every runtime dep (@modelcontextprotocol/sdk,
# zod, zod-to-json-schema, ajv*, and @concierge/core) into dist/index.js via
# `noExternal`. A separate node_modules/ in the shipped bundle is no longer
# necessary — and would fail to install anyway, since the vendor package's
# package.json points at @concierge/core via workspace:* which only resolves
# inside the monorepo. Skip node_modules vendoring entirely.

# --- 8. Zip to .mcpb ----------------------------------------------------------
# The .mcpb artifact lands at the repo root (two dirs up from this script).
MONOREPO_ROOT="$(cd "${REPO_ROOT}/../.." && pwd)"
OUT_NAME="Concierge-GoogleWorkspace-${VERSION}-${ARCH}.mcpb"
OUT_PATH="${MONOREPO_ROOT}/${OUT_NAME}"
rm -f "${OUT_PATH}"
(cd "${STAGE}" && zip -qr "${OUT_PATH}" .)

SIZE_BYTES="$(stat -f '%z' "${OUT_PATH}")"
SIZE_MB="$(awk -v b="${SIZE_BYTES}" 'BEGIN{printf "%.2f", b/1024/1024}')"
echo ""
echo "[pack] SUCCESS"
echo "[pack] artifact: ${OUT_PATH}"
echo "[pack] size:     ${SIZE_MB} MB (${SIZE_BYTES} bytes)"

# --- 9. Optional: sign + notarize for distribution ---------------------------
# Local dev builds skip signing (fast iteration). Release builds set
# CONCIERGE_SIGN=1 to produce a signed + notarized + stapled .mcpb that
# macOS Gatekeeper accepts without warning, even when a user downloads it
# via Safari/Mail/Drive (which sets the com.apple.quarantine xattr).
#
# Prereqs: Developer ID Application cert in keychain + concierge-notarize
# keychain profile. See build/sign-and-notarize.sh for details.
if [[ "${CONCIERGE_SIGN:-0}" == "1" ]]; then
  echo ""
  echo "[pack] CONCIERGE_SIGN=1 — invoking sign-and-notarize.sh"
  "${SCRIPT_DIR}/sign-and-notarize.sh" "${OUT_PATH}"
else
  echo "[pack] (unsigned dev build — set CONCIERGE_SIGN=1 for signed + notarized release)"
fi
