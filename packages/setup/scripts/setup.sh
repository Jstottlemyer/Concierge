#!/usr/bin/env bash
# E1: Concierge bootstrap one-liner.
#
# Pasted by users via:
#   bash -c "$(curl -fsSL https://github.com/Jstottlemyer/Concierge/releases/latest/download/setup.sh)"
#
# Installs prereqs (Homebrew, Node, cosign), downloads the @concierge/setup
# tarball + .sha256 + .sig + .pem, verifies BOTH SHA-256 and the cosign
# Rekor signature (no SHA-only fallback), extracts to a tempdir, and exec's
# the bundled Node entry point.
#
# Bash 3.2+ (macOS default). Avoids:
#   - empty-array splat under `set -u` (CLAUDE.md gotcha)
#   - EXIT-trap rc poisoning under `set -e` (CLAUDE.md gotcha — bit us in v0.2.0-rc1)
#
# Override hooks for tests / power users:
#   VERSION                       : "latest" (default) or a pinned semver like 2.0.0
#   CONCIERGE_TEST_ARCH           : override `uname -m` for x86 detection tests
#   CONCIERGE_TEST_BASE_URL       : override the GitHub release base URL
#   CONCIERGE_TEST_COSIGN_INSTALL_FAIL=1 : force the cosign install path to fail

set -euo pipefail
IFS=$'\n\t'

VERSION="${VERSION:-latest}"
REPO_OWNER="Jstottlemyer"
REPO_NAME="Concierge"
ARCH_TAG="darwin-arm64"

WORK_DIR=""
SUCCESS=0

cleanup() {
  if [[ $SUCCESS -eq 0 && -n "$WORK_DIR" && -d "$WORK_DIR" ]]; then
    rm -rf "$WORK_DIR"
  fi
  return 0
}
trap cleanup EXIT

print_recovery_path() {
  local tag
  if [[ "$VERSION" = "latest" ]]; then tag="<latest-tag>"; else tag="release-v${VERSION}"; fi
  cat <<EOF >&2

----------------------------------------------------------------------
Concierge bootstrap aborted. Manual recovery (verify by hand):

  1. Find the latest tag at:
       https://github.com/${REPO_OWNER}/${REPO_NAME}/releases
  2. Download the artifacts (replace TAG):
       gh release download ${tag} \\
         --repo ${REPO_OWNER}/${REPO_NAME} \\
         --pattern '@concierge/setup-*-${ARCH_TAG}.tar.gz*'
  3. Verify SHA-256:
       shasum -a 256 -c @concierge/setup-*-${ARCH_TAG}.tar.gz.sha256
  4. Verify cosign signature (Rekor keyless):
       cosign verify-blob \\
         --signature @concierge/setup-*-${ARCH_TAG}.tar.gz.sig \\
         --certificate @concierge/setup-*-${ARCH_TAG}.tar.gz.pem \\
         --certificate-identity-regexp '.*' \\
         --certificate-oidc-issuer-regexp '.*' \\
         @concierge/setup-*-${ARCH_TAG}.tar.gz
  5. Extract: tar -xzf @concierge/setup-*-${ARCH_TAG}.tar.gz
  6. Run: node ./dist/index.js

Full instructions: docs/setup/quickstart.md
----------------------------------------------------------------------
EOF
}

abort() {
  echo "concierge-setup: $*" >&2
  print_recovery_path
  exit 1
}

ensure_arch() {
  local m="${CONCIERGE_TEST_ARCH:-$(uname -m)}"
  if [[ "$m" != "arm64" ]]; then
    echo "concierge-setup: Concierge v2.0 supports macOS Apple Silicon only;" >&2
    echo "see docs/setup/quickstart.md for x86 manual install path." >&2
    exit 1
  fi
}

ensure_homebrew() {
  if command -v brew >/dev/null 2>&1; then return 0; fi
  echo "concierge-setup: installing Homebrew..." >&2
  bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" \
    || abort "Homebrew install failed"
}

ensure_node() {
  if command -v node >/dev/null 2>&1; then return 0; fi
  echo "concierge-setup: installing Node via brew..." >&2
  brew install node || abort "brew install node failed"
}

ensure_cosign() {
  if command -v cosign >/dev/null 2>&1; then return 0; fi
  echo "concierge-setup: installing cosign via brew..." >&2
  if [[ "${CONCIERGE_TEST_COSIGN_INSTALL_FAIL:-0}" = "1" ]]; then
    abort "cosign install failed (test mode); refusing to fall back to SHA-256-only"
  fi
  brew install cosign \
    || abort "brew install cosign failed; refusing to fall back to SHA-256-only verification"
}

resolve_base_url() {
  if [[ -n "${CONCIERGE_TEST_BASE_URL:-}" ]]; then
    echo "${CONCIERGE_TEST_BASE_URL%/}/"
  elif [[ "$VERSION" = "latest" ]]; then
    echo "https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest/download/"
  else
    echo "https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/release-v${VERSION}/"
  fi
}

# N11 spec: literal `@concierge/` org prefix is part of the published filename.
tarball_name() {
  echo "@concierge/setup-${VERSION}-${ARCH_TAG}.tar.gz"
}

assert_tarball_name() {
  local n="$1"
  if ! [[ "$n" =~ ^@concierge/setup-[^/]+-darwin-arm64\.tar\.gz$ ]]; then
    abort "internal error: tarball name '$n' does not match published shape"
  fi
}

download_artifacts() {
  local base="$1"
  local name="$2"
  local f
  local f out
  for f in "$name" "${name}.sha256" "${name}.sig" "${name}.pem"; do
    out="${WORK_DIR}/$(basename "$f")"
    curl -fsSL -o "$out" "${base}${f}" \
      || abort "download failed: ${base}${f}"
  done
}

verify_sha256() {
  local name="$1"
  local base
  base="$(basename "$name")"
  ( cd "$WORK_DIR" && shasum -a 256 -c "${base}.sha256" >/dev/null ) \
    || abort "tarball SHA-256 mismatch — refusing to extract"
}

# TODO(v2.1): pin certificate-identity-regexp to the workflow URL once
# release.yml (F1) is stable, e.g.
#   https://github.com/Jstottlemyer/Concierge/.github/workflows/release.yml@refs/tags/release-v*
verify_cosign() {
  local name="$1"
  local base
  base="$(basename "$name")"
  ( cd "$WORK_DIR" && cosign verify-blob \
      --signature "${base}.sig" \
      --certificate "${base}.pem" \
      --certificate-identity-regexp '.*' \
      --certificate-oidc-issuer-regexp '.*' \
      "$base" >/dev/null 2>&1 ) \
    || abort "cosign signature verification failed — refusing to extract"
}

extract_and_exec() {
  local name="$1"
  shift  # remaining "$@" is the user-provided argv to forward to node.
  local base
  base="$(basename "$name")"
  local extract_dir="${WORK_DIR}/extract"
  mkdir -p "$extract_dir"
  tar -xzf "${WORK_DIR}/${base}" -C "$extract_dir" \
    || abort "tar extract failed"
  local entry="${extract_dir}/dist/index.js"
  if [[ ! -f "$entry" ]]; then
    abort "extracted tarball missing dist/index.js (layout mismatch)"
  fi
  SUCCESS=1
  local node_bin
  node_bin="$(command -v node || echo /usr/bin/env)"
  if [[ "$node_bin" = "/usr/bin/env" ]]; then
    exec /usr/bin/env node "$entry" "$@"
  fi
  exec "$node_bin" "$entry" "$@"
}

main() {
  ensure_arch
  ensure_homebrew
  ensure_node
  ensure_cosign

  WORK_DIR="$(mktemp -d -t concierge-setup.XXXXXX)"
  local base_url tarball
  base_url="$(resolve_base_url)"
  tarball="$(tarball_name)"
  assert_tarball_name "$tarball"

  download_artifacts "$base_url" "$tarball"
  verify_sha256 "$tarball"
  verify_cosign "$tarball"
  extract_and_exec "$tarball" "$@"
}

main "$@"
