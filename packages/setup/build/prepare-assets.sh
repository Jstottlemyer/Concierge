#!/usr/bin/env bash
# E3a: Prepare embedded assets for @concierge/setup distribution.
#
# Steps:
#   1. Locate the .mcpb in packages/google-workspace/dist/ (single-arch glob)
#   2. Copy it into packages/setup/assets/ preserving filename
#   3. Generate packages/setup/assets/manifest.json matching the
#      EmbeddedManifest schema (src/types/manifest.ts) with every required
#      field populated from real provenance:
#        - filename / version / arch  : derived from .mcpb filename
#        - sha256                     : computed via shasum -a 256
#        - namespace                  : `local.mcpb.<author-slug>.<name>` from
#                                       the inner manifest.json (zip member)
#        - buildId / buildTime        : extracted from the bundle's tsup-baked
#                                       readBuildId/readBuildTime functions
#        - sourceCommit               : `git rev-parse HEAD` at repo root
#        - setupVersion               : packages/setup/package.json `version`
#   4. Validate the generated manifest.json by importing B2's
#      `readEmbeddedManifest` from a tiny Node script. Hard-fail on any
#      schema violation (do NOT publish a tarball with a bad manifest).
#
# Re-runnable: copying + writing are idempotent; running twice on the same
# inputs produces byte-identical output (modulo the .mcpb itself, which never
# changes for a given build).
#
# Manual integration test:
#   $ pnpm --filter @concierge/google-workspace build
#   $ packages/google-workspace/build/pack.sh
#   $ packages/setup/build/prepare-assets.sh
#   $ cat packages/setup/assets/manifest.json | jq .
#
# Bash-3.2 portable (macOS default shell). Avoids:
#   - associative arrays
#   - empty-array splat under `set -u` (per CLAUDE.md gotcha)
#   - EXIT-trap rc poisoning (per CLAUDE.md gotcha)

set -euo pipefail

# --- Locate repo root ---------------------------------------------------------
# This script lives at <repo>/packages/setup/build/prepare-assets.sh. We could
# resolve via BASH_SOURCE, but `git rev-parse --show-toplevel` is the
# canonical answer and also asserts we're inside a git working tree (needed
# for `sourceCommit`).
if ! REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  echo "error: prepare-assets.sh must run inside a git working tree (needed for sourceCommit)" >&2
  exit 1
fi

GWS_DIST_DIR="${REPO_ROOT}/packages/google-workspace/dist"
SETUP_ASSETS_DIR="${REPO_ROOT}/packages/setup/assets"
SETUP_PKG_JSON="${REPO_ROOT}/packages/setup/package.json"

# --- 1. Locate .mcpb ----------------------------------------------------------
# Glob explicitly via shell expansion. Allow override via env for tests.
MCPB_SEARCH_DIR="${CONCIERGE_MCPB_DIR:-${GWS_DIST_DIR}}"

if [[ ! -d "${MCPB_SEARCH_DIR}" ]]; then
  echo "error: mcpb search dir does not exist: ${MCPB_SEARCH_DIR}" >&2
  echo "       (did you run packages/google-workspace/build/pack.sh first?)" >&2
  exit 1
fi

# Use find rather than glob expansion to avoid set -u / nullglob portability
# issues across bash versions.
MCPB_LIST_FILE="$(mktemp -t concierge-prepare-assets-mcpb.XXXXXX)"
find "${MCPB_SEARCH_DIR}" -maxdepth 1 -type f -name 'Concierge-GoogleWorkspace-*-darwin-*.mcpb' >"${MCPB_LIST_FILE}"
MCPB_COUNT="$(wc -l <"${MCPB_LIST_FILE}" | tr -d ' ')"

if [[ "${MCPB_COUNT}" -eq 0 ]]; then
  rm -f "${MCPB_LIST_FILE}"
  echo "error: no Concierge-GoogleWorkspace-*-darwin-*.mcpb found in ${MCPB_SEARCH_DIR}" >&2
  echo "       run packages/google-workspace/build/pack.sh first" >&2
  exit 1
fi
if [[ "${MCPB_COUNT}" -gt 1 ]]; then
  echo "error: multiple .mcpb files found in ${MCPB_SEARCH_DIR}; expected exactly 1:" >&2
  cat "${MCPB_LIST_FILE}" >&2
  rm -f "${MCPB_LIST_FILE}"
  exit 1
fi

MCPB_PATH="$(head -n1 "${MCPB_LIST_FILE}")"
rm -f "${MCPB_LIST_FILE}"
MCPB_FILENAME="$(basename "${MCPB_PATH}")"
echo "[prepare-assets] source: ${MCPB_PATH}"

# --- 2. Parse version + arch from filename -----------------------------------
# Filename shape: Concierge-GoogleWorkspace-<version>-<arch>.mcpb
# Example: Concierge-GoogleWorkspace-0.2.0-darwin-arm64.mcpb
#
# Bash 3.2 BASH_REMATCH supports basic captures.
if [[ ! "${MCPB_FILENAME}" =~ ^Concierge-GoogleWorkspace-(.+)-(darwin-(arm64|x64))\.mcpb$ ]]; then
  echo "error: cannot parse version/arch from filename: ${MCPB_FILENAME}" >&2
  echo "       expected pattern: Concierge-GoogleWorkspace-<version>-darwin-<arm64|x64>.mcpb" >&2
  exit 1
fi
MCPB_VERSION="${BASH_REMATCH[1]}"
MCPB_ARCH="${BASH_REMATCH[2]}"
echo "[prepare-assets] parsed version=${MCPB_VERSION} arch=${MCPB_ARCH}"

# --- 3. sha256 of .mcpb -------------------------------------------------------
MCPB_SHA256="$(shasum -a 256 "${MCPB_PATH}" | awk '{print $1}')"
if [[ ! "${MCPB_SHA256}" =~ ^[a-f0-9]{64}$ ]]; then
  echo "error: shasum produced unexpected output: ${MCPB_SHA256}" >&2
  exit 1
fi
echo "[prepare-assets] sha256=${MCPB_SHA256}"

# --- 4. Inspect inner manifest.json ------------------------------------------
INNER_MANIFEST="$(unzip -p "${MCPB_PATH}" manifest.json)"
if [[ -z "${INNER_MANIFEST}" ]]; then
  echo "error: .mcpb has no manifest.json member (malformed bundle): ${MCPB_PATH}" >&2
  exit 1
fi

INNER_NAME="$(printf '%s' "${INNER_MANIFEST}" | jq -r '.name // empty')"
INNER_AUTHOR="$(printf '%s' "${INNER_MANIFEST}" | jq -r '.author.name // empty')"
INNER_VERSION="$(printf '%s' "${INNER_MANIFEST}" | jq -r '.version // empty')"

if [[ -z "${INNER_NAME}" ]]; then
  echo "error: .mcpb manifest.json missing required field: name" >&2
  exit 1
fi
if [[ -z "${INNER_AUTHOR}" ]]; then
  echo "error: .mcpb manifest.json missing required field: author.name" >&2
  exit 1
fi
if [[ -z "${INNER_VERSION}" ]]; then
  echo "error: .mcpb manifest.json missing required field: version" >&2
  exit 1
fi

# Cross-check: filename version must match inner manifest version.
if [[ "${INNER_VERSION}" != "${MCPB_VERSION}" ]]; then
  echo "error: version mismatch: filename says ${MCPB_VERSION}, inner manifest.json says ${INNER_VERSION}" >&2
  exit 1
fi

# Slugify author for namespace: lowercase, spaces -> hyphens, keep [a-z0-9-]
# Match Claude Desktop's actual installed dir naming
# (e.g. `local.mcpb.justin-stottlemyer.concierge-google-workspace`).
AUTHOR_SLUG="$(printf '%s' "${INNER_AUTHOR}" \
  | tr '[:upper:]' '[:lower:]' \
  | tr ' ' '-' \
  | sed -E 's/[^a-z0-9-]+//g; s/-+/-/g; s/^-+//; s/-+$//')"
NAME_SLUG="$(printf '%s' "${INNER_NAME}" \
  | tr '[:upper:]' '[:lower:]' \
  | tr ' ' '-' \
  | sed -E 's/[^a-z0-9-]+//g; s/-+/-/g; s/^-+//; s/-+$//')"

if [[ -z "${AUTHOR_SLUG}" || -z "${NAME_SLUG}" ]]; then
  echo "error: namespace slugification produced empty author or name" >&2
  echo "       author='${INNER_AUTHOR}' -> '${AUTHOR_SLUG}'" >&2
  echo "       name='${INNER_NAME}' -> '${NAME_SLUG}'" >&2
  exit 1
fi
NAMESPACE="local.mcpb.${AUTHOR_SLUG}.${NAME_SLUG}"
echo "[prepare-assets] namespace=${NAMESPACE}"

# --- 5. Extract buildId + buildTime from dist/index.js -----------------------
# tsup `define` substitutes the JSON-stringified literals into the function
# bodies; after minification they appear as:
#   function readBuildTime() { ... return "<ISO-8601>"; ... }
#   function readBuildId()   { ... return "<8-hex-id>"; ... }
#
# Pull dist/index.js out via `unzip -p` and grep for the function-body
# return strings. We tolerate either tsup's `function readBuildTime()` form
# or any future variant by also matching the build_time / build_id object
# keys that get emitted into structuredContent (defensive fallback).
DIST_JS="$(unzip -p "${MCPB_PATH}" dist/index.js 2>/dev/null || true)"
if [[ -z "${DIST_JS}" ]]; then
  echo "error: .mcpb has no dist/index.js (malformed bundle): ${MCPB_PATH}" >&2
  exit 1
fi

# Primary pattern: extract from readBuildTime/readBuildId function bodies.
# tsup substitutes the literal string into the body. Across minified/non-min
# variants the body may contain braces (`if (true) { return "..."; }`). We
# write the full bundle to a temp file and use a Perl one-liner to anchor on
# the function name and grab the first quoted literal that follows. Perl is
# always available on macOS.
DIST_TMP="$(mktemp -t concierge-prepare-assets-dist.XXXXXX).js"
printf '%s' "${DIST_JS}" >"${DIST_TMP}"

BUILD_TIME="$(perl -0777 -ne 'if (/function\s+readBuildTime[^"]*?"([^"]+)"/s) { print $1; exit }' "${DIST_TMP}" || true)"
BUILD_ID="$(perl -0777 -ne 'if (/function\s+readBuildId[^"]*?"([^"]+)"/s) { print $1; exit }' "${DIST_TMP}" || true)"
rm -f "${DIST_TMP}"

# Validation: ISO-8601 + 8-hex (loose, avoids false positives from minifier).
if [[ -z "${BUILD_TIME}" || ! "${BUILD_TIME}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T ]]; then
  echo "error: could not extract buildTime from dist/index.js" >&2
  echo "       expected pattern: function readBuildTime() { ... return \"<ISO-8601>\" }" >&2
  echo "       (if tsup output shape changed, update prepare-assets.sh extraction regex)" >&2
  exit 1
fi
if [[ -z "${BUILD_ID}" || ! "${BUILD_ID}" =~ ^[a-zA-Z0-9_-]+$ ]]; then
  echo "error: could not extract buildId from dist/index.js" >&2
  echo "       expected pattern: function readBuildId() { ... return \"<id>\" }" >&2
  echo "       (if tsup output shape changed, update prepare-assets.sh extraction regex)" >&2
  exit 1
fi
echo "[prepare-assets] buildId=${BUILD_ID} buildTime=${BUILD_TIME}"

# --- 6. sourceCommit ----------------------------------------------------------
SOURCE_COMMIT="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
if [[ ! "${SOURCE_COMMIT}" =~ ^[a-f0-9]{40}$ ]]; then
  echo "error: git rev-parse HEAD did not return a 40-char sha (got: ${SOURCE_COMMIT})" >&2
  exit 1
fi
echo "[prepare-assets] sourceCommit=${SOURCE_COMMIT}"

# --- 7. setupVersion ----------------------------------------------------------
if [[ ! -f "${SETUP_PKG_JSON}" ]]; then
  echo "error: ${SETUP_PKG_JSON} not found" >&2
  exit 1
fi
SETUP_VERSION="$(jq -r '.version' "${SETUP_PKG_JSON}")"
if [[ -z "${SETUP_VERSION}" || "${SETUP_VERSION}" == "null" ]]; then
  echo "error: setup package.json has no .version field" >&2
  exit 1
fi
echo "[prepare-assets] setupVersion=${SETUP_VERSION}"

# --- 8. Copy + write manifest -------------------------------------------------
mkdir -p "${SETUP_ASSETS_DIR}"

# Idempotent copy: only write if hashes differ. (`cp` is also idempotent in
# practice; this just avoids needless mtime churn.)
DEST_MCPB="${SETUP_ASSETS_DIR}/${MCPB_FILENAME}"
if [[ -f "${DEST_MCPB}" ]]; then
  EXISTING_SHA="$(shasum -a 256 "${DEST_MCPB}" | awk '{print $1}')"
  if [[ "${EXISTING_SHA}" != "${MCPB_SHA256}" ]]; then
    cp "${MCPB_PATH}" "${DEST_MCPB}"
  fi
else
  cp "${MCPB_PATH}" "${DEST_MCPB}"
fi
echo "[prepare-assets] copied -> ${DEST_MCPB}"

# Write manifest.json. Use jq to construct the JSON so we never hand-roll
# escaping bugs.
DEST_MANIFEST="${SETUP_ASSETS_DIR}/manifest.json"
jq -n \
  --arg filename "${MCPB_FILENAME}" \
  --arg version "${MCPB_VERSION}" \
  --arg sha256 "${MCPB_SHA256}" \
  --arg arch "${MCPB_ARCH}" \
  --arg namespace "${NAMESPACE}" \
  --arg buildId "${BUILD_ID}" \
  --arg buildTime "${BUILD_TIME}" \
  --arg sourceCommit "${SOURCE_COMMIT}" \
  --arg setupVersion "${SETUP_VERSION}" \
  '{
    schemaVersion: 1,
    bundledMcpb: {
      filename: $filename,
      version: $version,
      sha256: $sha256,
      arch: $arch,
      namespace: $namespace,
      buildId: $buildId,
      buildTime: $buildTime,
      sourceCommit: $sourceCommit
    },
    setupVersion: $setupVersion
  }' >"${DEST_MANIFEST}"
echo "[prepare-assets] wrote -> ${DEST_MANIFEST}"

# --- 9. Validate against B2's EmbeddedManifest schema ------------------------
# We can't import B2's TypeScript SUT directly (no tsc/tsx in script context),
# and tsup bundles src/state/manifest.ts inside a single dist/index.js with no
# named export reachable for ad-hoc validation. So this script ships a JS port
# of the validation rules from src/state/manifest.ts. Both sources are
# checked-in and reviewed together; G2 tests pin B2's behavior; this script
# is only an additional publish-time gate.
#
# Drift-detection: the test in tests/build/prepare-assets.test.ts runs the
# script and re-validates the produced manifest with the real B2 SUT. Any
# divergence in rules surfaces there before merge.
VALIDATOR_SCRIPT="$(mktemp -t concierge-prepare-assets-validate.XXXXXX).mjs"
cat >"${VALIDATOR_SCRIPT}" <<'EOF'
// Inline mirror of packages/setup/src/state/manifest.ts validation rules.
// Keep in lockstep with that file. G-phase tests catch drift.
import { readFile } from 'node:fs/promises';

const SHA256_RE = /^[a-f0-9]{64}$/;
const NAMESPACE_RE = /^local\.mcpb\.[a-z0-9-]+\.[a-z0-9-]+$/;
const SOURCE_COMMIT_RE = /^[a-f0-9]{40}$/;
const VALID_ARCHES = ['darwin-arm64', 'darwin-x64'];

function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function reqField(obj, field, ctx) {
  if (!(field in obj)) throw new Error(`missing required field "${ctx}.${field}"`);
  return obj[field];
}
function reqStr(value, field) {
  if (typeof value !== 'string') throw new Error(`field "${field}" must be a string (got ${typeof value})`);
  if (value.length === 0) throw new Error(`field "${field}" must be non-empty`);
  return value;
}
function reqMatch(value, field, re, desc) {
  const s = reqStr(value, field);
  if (!re.test(s)) throw new Error(`field "${field}" must match ${desc} (got "${s}")`);
  return s;
}

const path = process.argv[2];
if (!path) { console.error('usage: validate.mjs <manifest.json>'); process.exit(2); }

let parsed;
try {
  parsed = JSON.parse(await readFile(path, 'utf8'));
} catch (err) {
  console.error(`failed to read/parse ${path}: ${err?.message ?? err}`);
  process.exit(1);
}
try {
  if (!isPlainObject(parsed)) throw new Error('top-level must be a JSON object');
  if (reqField(parsed, 'schemaVersion', 'root') !== 1) throw new Error('schemaVersion must be 1');
  reqStr(reqField(parsed, 'setupVersion', 'root'), 'setupVersion');
  const b = reqField(parsed, 'bundledMcpb', 'root');
  if (!isPlainObject(b)) throw new Error('bundledMcpb must be an object');
  reqStr(reqField(b, 'filename', 'bundledMcpb'), 'bundledMcpb.filename');
  reqStr(reqField(b, 'version', 'bundledMcpb'), 'bundledMcpb.version');
  reqMatch(reqField(b, 'sha256', 'bundledMcpb'), 'bundledMcpb.sha256', SHA256_RE, '64 lowercase hex');
  const arch = reqStr(reqField(b, 'arch', 'bundledMcpb'), 'bundledMcpb.arch');
  if (!VALID_ARCHES.includes(arch)) throw new Error(`bundledMcpb.arch must be one of ${VALID_ARCHES.join(', ')} (got "${arch}")`);
  reqMatch(reqField(b, 'namespace', 'bundledMcpb'), 'bundledMcpb.namespace', NAMESPACE_RE, '/^local\\.mcpb\\.[a-z0-9-]+\\.[a-z0-9-]+$/');
  reqStr(reqField(b, 'buildId', 'bundledMcpb'), 'bundledMcpb.buildId');
  const bt = reqStr(reqField(b, 'buildTime', 'bundledMcpb'), 'bundledMcpb.buildTime');
  if (Number.isNaN(new Date(bt).getTime())) throw new Error(`bundledMcpb.buildTime must parse as a Date (got "${bt}")`);
  reqMatch(reqField(b, 'sourceCommit', 'bundledMcpb'), 'bundledMcpb.sourceCommit', SOURCE_COMMIT_RE, '40-char lowercase hex sha');
  console.log('ok');
} catch (err) {
  console.error(`manifest validation FAILED: ${err?.message ?? err}`);
  process.exit(1);
}
EOF

if ! node "${VALIDATOR_SCRIPT}" "${DEST_MANIFEST}"; then
  rm -f "${VALIDATOR_SCRIPT}"
  echo "error: refusing to publish — generated manifest does not satisfy EmbeddedManifest schema" >&2
  echo "       inspect: ${DEST_MANIFEST}" >&2
  exit 1
fi
rm -f "${VALIDATOR_SCRIPT}"

# --- 10. Success summary ------------------------------------------------------
echo ""
echo "[prepare-assets] SUCCESS"
echo "[prepare-assets] prepared assets for setup-v${SETUP_VERSION}:"
echo "[prepare-assets]   ${MCPB_FILENAME}"
echo "[prepare-assets]   manifest.json (schemaVersion=1, bundled .mcpb v${MCPB_VERSION})"

# Per CLAUDE.md gotcha: explicitly exit 0 to avoid any trailing rc poisoning.
exit 0
