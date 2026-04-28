#!/usr/bin/env bash
# E3b: Pack @concierge/setup into a release tarball + SHA-256 + cosign signature.
#
# Inputs (must already exist):
#   packages/setup/dist/index.js       (from `pnpm --filter @concierge/setup build`)
#   packages/setup/assets/manifest.json (from build/prepare-assets.sh, E3a)
#   packages/setup/assets/*.mcpb        (from build/prepare-assets.sh, E3a)
#
# Outputs (written to packages/setup/dist-release/):
#   @concierge/setup-<version>-darwin-arm64.tar.gz
#   @concierge/setup-<version>-darwin-arm64.tar.gz.sha256
#   @concierge/setup-<version>-darwin-arm64.tar.gz.sig    (cosign keyless)
#   @concierge/setup-<version>-darwin-arm64.tar.gz.pem    (cosign keyless cert)
#
# E1 (bash bootstrap, runs at user-install time, parallel branch) consumes
# these names verbatim. Do NOT rename without updating E1.
#
# Bash 3.2 portable (macOS default). EXIT-trap exits cleanly per CLAUDE.md.

set -euo pipefail
IFS=$'\n\t'

# --- Locate package + version -------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Tests override PKG_DIR via CONCIERGE_PKG_DIR to isolate from dev's real
# packages/setup/dist + assets dirs. Production runs use the script-relative
# default.
PKG_DIR="${CONCIERGE_PKG_DIR:-$(cd "${SCRIPT_DIR}/.." && pwd)}"
cd "${PKG_DIR}"

if [[ ! -f "${PKG_DIR}/package.json" ]]; then
  echo "error: ${PKG_DIR}/package.json not found" >&2
  exit 1
fi

VERSION="$(node -p "require('./package.json').version")"
if [[ -z "${VERSION}" || "${VERSION}" == "undefined" ]]; then
  echo "error: could not read version from ${PKG_DIR}/package.json" >&2
  exit 1
fi

ARCH="darwin-arm64"
TARBALL_NAME="@concierge/setup-${VERSION}-${ARCH}.tar.gz"
DIST_RELEASE_DIR="${PKG_DIR}/dist-release"
TARBALL_PATH="${DIST_RELEASE_DIR}/${TARBALL_NAME}"

# --- EXIT trap: clean partial outputs on failure ------------------------------
SCRIPT_OK=0
# shellcheck disable=SC2329  # invoked indirectly via `trap ... EXIT`
cleanup_on_failure() {
  if [[ "${SCRIPT_OK}" -eq 0 ]]; then
    if [[ -n "${TARBALL_PATH:-}" ]]; then
      rm -f "${TARBALL_PATH}" "${TARBALL_PATH}.sha256" "${TARBALL_PATH}.sig" "${TARBALL_PATH}.pem"
    fi
  fi
  return 0
}
trap cleanup_on_failure EXIT

# --- Step functions -----------------------------------------------------------

verify_inputs() {
  echo "==> Verifying inputs ..."
  if [[ ! -f "${PKG_DIR}/dist/index.js" ]]; then
    echo "error: dist/index.js not found — run pnpm --filter @concierge/setup build first" >&2
    exit 1
  fi
  if [[ ! -f "${PKG_DIR}/assets/manifest.json" ]]; then
    echo "error: assets/manifest.json not found — run prepare-assets.sh first" >&2
    exit 1
  fi
  # At least one .mcpb in assets/
  local mcpb_list
  mcpb_list="$(find "${PKG_DIR}/assets" -maxdepth 1 -type f -name '*.mcpb' | head -n1)"
  if [[ -z "${mcpb_list}" ]]; then
    echo "error: no *.mcpb in assets/ — run prepare-assets.sh first" >&2
    exit 1
  fi
}

build_tarball() {
  echo "==> Building tarball ${TARBALL_NAME} ..."
  # `@concierge/setup-...` contains a literal `/`, which on a real filesystem
  # is a path separator — so the tarball lives at dist-release/@concierge/
  # /setup-<v>-darwin-arm64.tar.gz. mkdir the parent (which is
  # dist-release/@concierge) so tar can write there.
  mkdir -p "$(dirname "${TARBALL_PATH}")"
  rm -f "${TARBALL_PATH}"
  # Tar dist/ + assets/ + package.json. Explicit excludes guard against
  # accidental inclusion if the caller staged something weird.
  tar -czf "${TARBALL_PATH}" \
    --exclude='node_modules' \
    --exclude='tests' \
    --exclude='src' \
    --exclude='.DS_Store' \
    -C "${PKG_DIR}" \
    dist assets package.json
}

verify_tarball_layout() {
  echo "==> Verifying tarball layout ..."
  local entries
  entries="$(tar -tzf "${TARBALL_PATH}" | head -50)"
  if ! printf '%s\n' "${entries}" | grep -q '^dist/index\.js$'; then
    echo "error: tarball does not contain dist/index.js — entries:" >&2
    printf '%s\n' "${entries}" >&2
    exit 1
  fi
  if ! printf '%s\n' "${entries}" | grep -q '^assets/manifest\.json$'; then
    echo "error: tarball does not contain assets/manifest.json — entries:" >&2
    printf '%s\n' "${entries}" >&2
    exit 1
  fi
  if ! printf '%s\n' "${entries}" | grep -q '^package\.json$'; then
    echo "error: tarball does not contain package.json — entries:" >&2
    printf '%s\n' "${entries}" >&2
    exit 1
  fi
}

compute_sha256() {
  echo "==> Computing SHA-256 ..."
  # `shasum -a 256 <file>` produces "<hex>  <file>" — the canonical
  # `shasum -c`-checkable format. Strip directory components from the path
  # so the digest is self-contained when verified from any cwd.
  ( cd "${DIST_RELEASE_DIR}" && shasum -a 256 "${TARBALL_NAME}" > "${TARBALL_NAME}.sha256" )
}

sign_with_cosign() {
  echo "==> Signing with cosign ..."
  if ! command -v cosign >/dev/null 2>&1; then
    echo "error: cosign not installed — run \`brew install cosign\` (macOS) or use sigstore/cosign-installer in CI" >&2
    echo "       this signature is mandatory for Rekor keyless verification at install time" >&2
    exit 1
  fi
  # Test seam: synthetic failure for the cosign-failure test case.
  if [[ "${CONCIERGE_TEST_COSIGN_FAIL:-0}" == "1" ]]; then
    echo "error: cosign signing failed (CONCIERGE_TEST_COSIGN_FAIL=1)" >&2
    exit 1
  fi
  cosign sign-blob --yes \
    --output-signature "${TARBALL_PATH}.sig" \
    --output-certificate "${TARBALL_PATH}.pem" \
    "${TARBALL_PATH}"
  if [[ ! -s "${TARBALL_PATH}.sig" ]]; then
    echo "error: cosign produced empty signature file" >&2
    exit 1
  fi
  if [[ ! -s "${TARBALL_PATH}.pem" ]]; then
    echo "error: cosign produced empty certificate file" >&2
    exit 1
  fi
}

print_summary() {
  echo ""
  echo "==> SUCCESS"
  echo "Outputs (absolute paths — F1 release.yml gh release upload these atomically):"
  echo "  ${TARBALL_PATH}"
  echo "  ${TARBALL_PATH}.sha256"
  echo "  ${TARBALL_PATH}.sig"
  echo "  ${TARBALL_PATH}.pem"
}

# --- Main ---------------------------------------------------------------------

verify_inputs
build_tarball
verify_tarball_layout
compute_sha256
sign_with_cosign
print_summary

SCRIPT_OK=1
exit 0
