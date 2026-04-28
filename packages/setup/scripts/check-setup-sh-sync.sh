#!/usr/bin/env bash
# E4: assert that the two copies of setup.sh are byte-identical.
#
# We ship the bootstrap script in two places:
#   - scripts/setup.sh                          (repo root — the curl-target)
#   - packages/setup/scripts/setup.sh           (package-local — the source of truth)
#
# The root copy is what the user pastes from a curl one-liner; the package copy
# is what ships inside the @concierge/setup tarball and what the test suite
# exercises. Drift between them is a release-blocking footgun: the user would
# install a different script than CI verified.
#
# This script diffs the two and exits non-zero on any divergence. CI runs it
# in the lint+typecheck job; a failing exit aborts the workflow.

set -euo pipefail
IFS=$'\n\t'

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SOURCE_OF_TRUTH="${REPO_ROOT}/packages/setup/scripts/setup.sh"
ROOT_COPY="${REPO_ROOT}/scripts/setup.sh"

if [ ! -f "$SOURCE_OF_TRUTH" ]; then
  echo "check-setup-sh-sync: source-of-truth missing at $SOURCE_OF_TRUTH" >&2
  exit 2
fi

if [ ! -f "$ROOT_COPY" ]; then
  echo "check-setup-sh-sync: root copy missing at $ROOT_COPY" >&2
  echo "Recover with: cp \"$SOURCE_OF_TRUTH\" \"$ROOT_COPY\"" >&2
  exit 2
fi

if ! diff -q "$SOURCE_OF_TRUTH" "$ROOT_COPY" >/dev/null; then
  echo "check-setup-sh-sync: setup.sh copies have diverged" >&2
  echo "" >&2
  diff -u "$SOURCE_OF_TRUTH" "$ROOT_COPY" >&2 || true
  echo "" >&2
  echo "Recover with: cp \"$SOURCE_OF_TRUTH\" \"$ROOT_COPY\"" >&2
  exit 1
fi

echo "check-setup-sh-sync: OK (both copies identical)"
