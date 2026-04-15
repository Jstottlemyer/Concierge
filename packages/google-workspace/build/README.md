# build/ — pipeline artifacts

This directory holds build-pipeline artifacts that are committed to the repo
(not generated per-build outputs — those live in `dist/` and `.mcpb-staging/`).

## Files

- `gws-checksums.txt` — pinned sha256 hashes of the upstream `googleworkspace/cli`
  binary per platform/arch. Checked into git; CI's integrity gate (T20) verifies
  downloaded binaries match before bundling into the `.mcpb` package.

## Bumping the gws version

1. Update the version tag on every line of `gws-checksums.txt`.
2. Download each upstream release tarball, extract the `gws` binary, and
   compute `shasum -a 256 gws`. Paste the new hashes.
3. Commit all lines together in a single PR — CI will reject mismatches.
