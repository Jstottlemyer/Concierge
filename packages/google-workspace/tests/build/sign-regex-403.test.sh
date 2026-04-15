#!/bin/bash
# B3: Fixture test for the broadened 403 agreement-expired regex in
# sign-and-notarize.sh. Exercises all 4 positive variants Apple's notary has
# returned across different responses, plus a negative case (non-agreement
# 403) that MUST NOT match.
#
# Run: bash packages/google-workspace/tests/build/sign-regex-403.test.sh
# Expected: all assertions pass; script exits 0.
#
# The canonical regex lives in packages/google-workspace/build/sign-and-notarize.sh.
# If you change the regex there, update this file to match.

set -euo pipefail

REGEX='agreement.*(missing|expired|required|not[[:space:]]+(yet[[:space:]]+)?(been[[:space:]]+)?accepted)'

pass=0
fail=0

assert_match() {
  local label="$1" input="$2"
  if echo "$input" | grep -qiE "$REGEX"; then
    echo "PASS  match    : $label"
    pass=$((pass + 1))
  else
    echo "FAIL  match    : $label"
    echo "      input    : $input"
    fail=$((fail + 1))
  fi
}

assert_no_match() {
  local label="$1" input="$2"
  if echo "$input" | grep -qiE "$REGEX"; then
    echo "FAIL  no-match : $label"
    echo "      input    : $input"
    fail=$((fail + 1))
  else
    echo "PASS  no-match : $label"
    pass=$((pass + 1))
  fi
}

# ── Positive cases (must match) ──────────────────────────────────────────────

assert_match "Apple canonical 'missing or has expired'" \
  "Error: HTTP status code: 403. A required agreement is missing or has expired. This request requires an in-effect agreement that has not been signed or has expired. Ensure your team has signed the necessary legal agreements and that they are not expired."

assert_match "Variant 'Agreement has not yet been accepted'" \
  "Error: HTTP status code: 403. The Apple Developer Program License Agreement has not yet been accepted."

assert_match "Variant 'Agreement has not been accepted' (no 'yet')" \
  "Error: HTTP status code: 403. The Apple Developer Program License Agreement has not been accepted."

assert_match "Variant 'agreement is required'" \
  "Error: HTTP status code: 403. A signed agreement is required."

assert_match "Mixed-case phrasing" \
  "Agreement is MISSING or has EXPIRED."

# ── Negative cases (must NOT match) ──────────────────────────────────────────

assert_no_match "Non-agreement 403 — invalid credentials" \
  "Error: HTTP status code: 403. Invalid credentials. The provided username and password are incorrect."

assert_no_match "Non-agreement 403 — rate limit" \
  "Error: HTTP status code: 403. Rate limit exceeded. Please try again later."

assert_no_match "Generic 500 error" \
  "Error: HTTP status code: 500. Internal server error."

# Important: a message that mentions 'expired' but not an agreement must NOT
# match. The signer's 403 detection is scoped to agreement issues specifically;
# a token-expired or cert-expired error needs a different diagnostic.
assert_no_match "Token expired (not agreement)" \
  "Error: token has expired. Please reauthenticate."

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "─────────────────────────────────────"
echo "sign-regex-403 test: $pass passed, $fail failed"
if [[ $fail -gt 0 ]]; then
  echo "Regex under test: $REGEX"
  echo "Source: packages/google-workspace/build/sign-and-notarize.sh"
  exit 1
fi
