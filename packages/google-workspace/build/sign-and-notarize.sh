#!/bin/bash
# Sign + notarize a Concierge .mcpb for direct distribution.
#
# Usage:
#   ./build/sign-and-notarize.sh <path-to-mcpb>
#
# Requires:
#   - Developer ID Application cert in login keychain
#     (security find-identity -v -p codesigning | grep "Developer ID Application")
#   - notarytool keychain profile named "concierge-notarize"
#     Set up once via:
#       xcrun notarytool store-credentials concierge-notarize \
#         --apple-id <APPLE_ID> --team-id P5FDYS88B7 --password <APP_SPECIFIC_PASSWORD>
#   - python3 on PATH (ships with Xcode Command Line Tools) for JSON parsing
#   - optional: gtimeout from coreutils (brew install coreutils) to cap the
#     notary wait at 30 min. Without it, --wait has no upper bound.
#
# Produces a signed + notarized .mcpb. The bundled `bin/gws` Mach-O gets a
# Developer ID signature + hardened runtime + secure timestamp, and the zip is
# submitted to Apple's notary service so gws's cdhash lands on Apple's allow
# list. Gatekeeper's online check (when it runs — see note below) then passes.
#
# Gatekeeper caveat:
#   Apple's Gatekeeper only gates Mach-Os that carry `com.apple.quarantine`.
#   Claude Desktop extracts the .mcpb programmatically and — depending on its
#   unpacker and macOS version — may NOT propagate the quarantine xattr to
#   `bin/gws`. When the xattr is absent, Gatekeeper does not invoke an online
#   check at all. In that case the Developer ID signature still protects
#   against tampering and satisfies Apple's hardened-runtime requirements for
#   third-party bundled binaries, but the cloud notarization lookup is never
#   queried. Treat notarization as belt (tamper-evidence + Apple's
#   malware-scan gate) rather than suspenders for this distribution path.
#
# No stapler / outer-zip codesign:
#   `xcrun stapler staple` officially supports only .app / .pkg / .dmg / .kext.
#   Running it on an arbitrary zip is undefined. The outer .mcpb is not an
#   app bundle, and Claude Desktop never spawns it as one — signing the zip
#   would be wasted effort.
#
# Hardened-runtime entitlements:
#   None needed for gws (Rust CLI using `keyring` → SecItem, and `reqwest` →
#   HTTPS from a non-sandboxed process). No JIT, no unsigned exec memory, no
#   library-validation disable, no DYLD env overrides. `com.apple.security.
#   network.client` is App-Sandbox-only and irrelevant. See Apple TN3125.
#   Do NOT add entitlements "just in case" — they'd weaken the binary.
#
# IMPORTANT ordering:
#   Run verify-pack.sh BEFORE this script, not after. Signing rewrites
#   `bin/gws`, so its sha256 no longer matches `gws-checksums.txt` (which pins
#   the upstream tarball bytes). Verification MUST happen on the pre-signed
#   artifact.

set -euo pipefail

# SECURITY: never enable `set -x` in this script or in any caller that sets
# CONCIERGE_* env vars — a single echoed line can leak p12 password or API key
# contents to public workflow logs. If you need to debug locally, use
# `bash -v` or add targeted echoes, not blanket tracing.

MCPB="${1:?usage: $0 <path-to-mcpb>}"
if [[ ! -f "$MCPB" ]]; then
  echo "error: .mcpb not found at '$MCPB'" >&2
  exit 2
fi

MCPB="$(cd "$(dirname "$MCPB")" && pwd)/$(basename "$MCPB")"

# Defaults preserve byte-identical local behavior when no CONCIERGE_* overrides
# are set. CI wires these via env to point at its temp keychain / API-key
# profile. See docs/specs/ci-signing-automation/spec.md §Q1.
SIGNING_IDENTITY="${CONCIERGE_SIGNING_IDENTITY:-Developer ID Application: JUSTIN HAYES STOTTLEMYER (P5FDYS88B7)}"
TEAM_ID="${CONCIERGE_TEAM_ID:-P5FDYS88B7}"
NOTARY_PROFILE="${CONCIERGE_NOTARY_PROFILE:-concierge-notarize}"
GWS_IDENTIFIER="${CONCIERGE_GWS_IDENTIFIER:-com.justin-stottlemyer.concierge.gws}"
NOTARY_TIMEOUT_SEC="${CONCIERGE_NOTARY_TIMEOUT_SEC:-1800}"

echo "[sign] target: $MCPB"

WORK="$(mktemp -d -t concierge-sign.XXXXXX)"
MCPB_TMP=""
cleanup() {
  # IMPORTANT: this runs as an EXIT trap under `set -e`. A bare
  # `[[ -n "$VAR" ]] && rm ...` form silently poisons the script's
  # exit code to 1 when the variable is empty (the `[[ ]]` returns 1,
  # short-circuits the `&&`, and the trap inherits that rc). Use an
  # `if` block + explicit `return 0` to guarantee the happy-path
  # success exit code is preserved.
  rm -rf "$WORK" || true
  if [[ -n "$MCPB_TMP" ]]; then
    rm -f "$MCPB_TMP" || true
  fi
  return 0
}
trap cleanup EXIT

echo "[sign] 1/4 unpack"
cd "$WORK"
unzip -q "$MCPB"

echo "[sign] 2/4 sign nested gws binary (Developer ID + hardened runtime + timestamp)"
codesign --sign "$SIGNING_IDENTITY" \
         --identifier "$GWS_IDENTIFIER" \
         --options runtime \
         --timestamp \
         --force \
         bin/gws

if ! codesign --verify --strict --verbose=4 bin/gws 2>&1; then
  echo "[sign] ERROR: gws signature verification failed" >&2
  exit 1
fi
echo "[sign]   gws: signed + hardened runtime + timestamp ($GWS_IDENTIFIER)"

# Atomic repack: write to .tmp then rename. Prevents a failed `zip` from
# leaving the user with no .mcpb at all (the original is only replaced once
# the new one is fully written to disk).
echo "[sign] 3/4 repack .mcpb (atomic rename)"
MCPB_TMP="${MCPB}.tmp"
rm -f "$MCPB_TMP"
zip -qr "$MCPB_TMP" manifest.json bin dist LICENSE LICENSE.gws NOTICE.gws
mv -f "$MCPB_TMP" "$MCPB"
MCPB_TMP=""  # rename succeeded; nothing to clean

echo "[sign] 4/4 submit to Apple notary service (${NOTARY_TIMEOUT_SEC}s cap)"

# macOS doesn't ship `timeout` by default. Prefer coreutils `gtimeout` (brew),
# fall back to `timeout` (Linux builders), else warn and wait forever.
if command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_CMD=(gtimeout "$NOTARY_TIMEOUT_SEC")
elif command -v timeout >/dev/null 2>&1; then
  TIMEOUT_CMD=(timeout "$NOTARY_TIMEOUT_SEC")
else
  TIMEOUT_CMD=()
  echo "[sign] warning: no gtimeout/timeout on PATH — submission will wait indefinitely" >&2
  echo "[sign]          install via: brew install coreutils" >&2
fi

set +e
# bash 3.2 (macOS default) trips on "${empty_array[@]}" under `set -u`, so
# branch explicitly instead of splatting a possibly-empty TIMEOUT_CMD array.
if [[ ${#TIMEOUT_CMD[@]} -gt 0 ]]; then
  SUBMIT_JSON="$("${TIMEOUT_CMD[@]}" xcrun notarytool submit "$MCPB" \
    --keychain-profile "$NOTARY_PROFILE" \
    --team-id "$TEAM_ID" \
    --wait \
    --output-format json 2>&1)"
else
  SUBMIT_JSON="$(xcrun notarytool submit "$MCPB" \
    --keychain-profile "$NOTARY_PROFILE" \
    --team-id "$TEAM_ID" \
    --wait \
    --output-format json 2>&1)"
fi
SUBMIT_RC=$?
set -e

echo "$SUBMIT_JSON"

if [[ $SUBMIT_RC -eq 124 ]]; then
  echo "[sign] ERROR: notarytool exceeded ${NOTARY_TIMEOUT_SEC}s — submission still running on Apple side" >&2
  echo "[sign] check status later with:" >&2
  echo "  xcrun notarytool history --keychain-profile $NOTARY_PROFILE --team-id $TEAM_ID" >&2
  exit 1
fi

# Agreement-expired detection BEFORE the generic rc check. Apple's 403 response
# wording varies ("is missing or has expired" / "not yet accepted" / "not
# accepted" / "required agreement"), so we use a broadened regex. Exit code 2
# signals "go sign a Developer Program agreement" (distinct from generic fail).
if echo "$SUBMIT_JSON" | grep -qiE "agreement.*(missing|expired|required|not[[:space:]]+(yet[[:space:]]+)?(been[[:space:]]+)?accepted)"; then
  echo "::error title=Apple Developer Program agreement expired or unsigned::Sign at https://developer.apple.com/account/resources/agreements and https://appstoreconnect.apple.com/agreements" >&2
  exit 2
fi

if [[ $SUBMIT_RC -ne 0 ]]; then
  echo "[sign] ERROR: notarytool submit failed (rc=$SUBMIT_RC)" >&2
  exit 1
fi

# Extract status + id from JSON. python3 ships with Xcode Command Line Tools.
STATUS="$(python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("status",""))' <<<"$SUBMIT_JSON" 2>/dev/null || true)"
SUBMIT_ID="$(python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("id",""))' <<<"$SUBMIT_JSON" 2>/dev/null || true)"

if [[ -z "$STATUS" ]]; then
  echo "[sign] ERROR: could not parse notarytool JSON output (empty status)" >&2
  echo "[sign] is python3 on PATH?  xcode-select --install" >&2
  exit 1
fi

if [[ "$STATUS" != "Accepted" ]]; then
  echo "[sign] ERROR: notarization status '$STATUS' (expected Accepted)" >&2
  if [[ -n "$SUBMIT_ID" ]]; then
    echo "[sign] fetching log for submission $SUBMIT_ID..." >&2
    xcrun notarytool log "$SUBMIT_ID" --keychain-profile "$NOTARY_PROFILE" 2>&1 >&2 || true
  fi
  exit 1
fi

echo ""
echo "[sign] SUCCESS: $MCPB is signed and notarized."
echo "[sign] gws carries a Developer ID signature + hardened runtime + notarization ticket."
echo "[sign] Gatekeeper will validate online IF Claude Desktop's extraction preserves"
echo "[sign] com.apple.quarantine on bin/gws; otherwise the signature still guards against"
echo "[sign] tampering and satisfies Apple's third-party-binary requirements."
echo "[sign] submission id: $SUBMIT_ID"
