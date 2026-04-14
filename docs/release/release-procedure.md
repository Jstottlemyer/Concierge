# Release Procedure

1. Verify CI green on `main`.
2. Bump `package.json` version + commit: `chore: bump to vX.Y.Z`.
3. Tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. CI's `package-mcpb.yml` runs automatically:
   - arm64 + x64 `.mcpb` artifacts built
   - Draft GitHub Release created with both assets
5. Run the [manual verification checklist](manual-verification-checklist.md) against a fresh Mac or clean Claude Desktop profile.
6. Sign off on the checklist.
7. Publish the draft release.
8. Update [`docs/setup/user-onboarding.md`](../setup/user-onboarding.md) if the install URL changed.

## CVE SLA (from plan Decision #11)

When a security advisory lands in `googleworkspace/cli` or its deps:

1. Update `build/gws-checksums.txt` with the patched version's sha256.
2. Run the full integration suite (`CONCIERGE_INTEGRATION=1 pnpm test`).
3. Tag a patch release within **48 hours** of advisory publication.
4. Document the fix in release notes.

## Rollback

If a release is discovered broken after publication:

1. Mark the GitHub Release as **pre-release** (hides it from latest).
2. Tag a patch release from the last-known-good commit with a `chore: revert to vX.Y.Z-1` commit.
3. Notify users via release notes on the new release.
4. If the break is a security regression, follow the CVE SLA above.
