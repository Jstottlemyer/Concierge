#!/bin/sh
# Fake `gws` binary for AuthTools runner tests (T7).
#
# Supports a handful of test-only flags:
#   --version            prints a version line and exits 0
#   --fail-code <N>      exits with code N (prints optional stderr payload)
#   --sleep <seconds>    sleeps then exits 0 (timeout testing)
#   --stderr <text>      writes text to stderr
#   --echo-stdin         reads stdin, prints it to stdout, exits 0
#   --print-env <NAME>   echoes the named env var
# Any other argv: prints a JSON-ish payload with the argv and exits 0.

case "$1" in
  --version)
    echo "gws 0.22.5-fake"
    exit 0
    ;;
  --fail-code)
    shift
    code="$1"
    shift
    if [ "$1" = "--stderr" ]; then
      shift
      printf "%s" "$1" 1>&2
    fi
    exit "$code"
    ;;
  --sleep)
    shift
    sleep "$1"
    echo "slow"
    exit 0
    ;;
  --stderr)
    shift
    printf "%s" "$1" 1>&2
    exit 0
    ;;
  --echo-stdin)
    cat
    exit 0
    ;;
  --print-env)
    shift
    eval "echo \"\$$1\""
    exit 0
    ;;
  *)
    printf '{"ok":true,"args":"%s"}\n' "$*"
    exit 0
    ;;
esac
