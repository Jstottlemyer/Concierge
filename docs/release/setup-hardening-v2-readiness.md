---
title: setup-hardening-v2 Release Readiness
description: H-phase release-prep status — what's shipped, what's blocked on humans, what to do before the first release-v2.0.0 tag
---

# setup-hardening-v2 — Release Readiness

The `setup-hardening-v2` build is functionally complete on `main`. This page tracks the 4 H-phase release-prep tasks (H1–H4 from `docs/specs/setup-hardening-v2/plan.md`) and what gates each one separately from the others.

## Summary

| Task | Type | Status | Blocker |
|------|------|--------|---------|
| H1 | Cosign signing CI step + bash verify | **Effectively shipped** | E3b's `pack.sh` signs; F1's `release.yml` runs it on tag; E1's `setup.sh` verifies; unit tests cover both sides | — |
| H2 | Manual checklist × 3 personas | **Manual gate** | Justin runs `docs/release/setup-verification-checklist.md` against three real machines |
| H3 | Workspace admin doc reviewer signoff | **Manual gate** | Real Workspace IT admin (or senior security engineer fallback) reviews `docs/setup/workspace-admin-instructions.md` |
| H4 | `wiki-update` post-merge | **Defer to post-tag** | Run after H2 + H3 sign off and `release-v2.0.0` ships |

## H1 — Cosign signing + verify (shipped)

The cosign keyless signing pipeline is wired end-to-end across three earlier waves:

- **`packages/setup/build/pack.sh`** (E3b, Wave 10) — calls `cosign sign-blob --yes` to produce `.sig` + `.pem` for each release tarball. Fails loud if cosign isn't installed; no SHA-256-only fallback.
- **`.github/workflows/release.yml`** (F1, Wave 11) — the `package-setup` job runs `pack.sh` on `release-v*.*.*` tag push; `id-token: write` permission lets cosign get its OIDC token from GitHub Actions automatically.
- **`packages/setup/scripts/setup.sh`** (E1, Wave 10) — the bash bootstrap verifies the cosign signature against Rekor before extracting the tarball; aborts with the documented manual-recovery path on cosign install or verify failure.
- **Unit tests** — `tests/scripts/pack-sh.test.ts` (10 tests) exercises the sign path with a stubbed cosign; `tests/scripts/setup-sh.test.ts` (7 tests) exercises the verify path. Both stub cosign behavior with `CONCIERGE_TEST_COSIGN_FAIL` / `_INSTALL_FAIL` flags.

What is **not** in CI: a per-PR end-to-end smoke that runs `pack.sh` + `setup.sh` with a real (not stubbed) cosign round-trip. Rationale: the unit tests cover the script's logic; F1's release workflow exercises the real round-trip on every tag; an additional per-PR smoke would require either restricting the workflow to non-fork PRs (id-token won't propagate from forks) or using cosign experimental in-memory keys (which doesn't exercise the production OIDC path). Net: low marginal value, deferred unless we see a regression sneak past the existing tests.

## H2 — Manual checklist × 3 personas

`docs/release/setup-verification-checklist.md` (F6, Wave 6) lists the three personas and the steps to verify on each before signing off a `release-v*.*.*` tag:

1. **Fresh personal Gmail on a clean macOS Apple Silicon machine** — full one-command bootstrap; OAuth consent; success screen with matching `build_id`. Target ≤15 min.
2. **Fresh Workspace non-admin** — orchestrator generates `~/Desktop/concierge-admin-instructions-<timestamp>.txt`; clean exit. Target ≤5 min.
3. **Fresh Workspace Super Admin** — full bootstrap including the inline org Cloud ToS + App Access Controls walkthrough. Target ≤15 min.

Plus two migration-smoke rows on machines with v0.1.0 and v0.2.0 already installed.

**To complete:** Justin runs each scenario on a fresh-state machine (or a clean VM) and records pass/fail per row. Sign-off goes in the release notes for the `release-v2.0.0` tag.

## H3 — Workspace admin doc reviewer signoff (N5)

`docs/setup/workspace-admin-instructions.md` (F5, Wave 6) is the template a non-admin Workspace user forwards to their IT admin. Spec acceptance N5 requires that ≥1 real Workspace IT admin (or a senior security engineer as fallback) reviews the doc and confirms they would approve the OAuth app based solely on the doc — without needing additional context from the user.

**To complete:**
1. Identify a reviewer. Best path: reach out to a real Workspace IT admin (e.g., a contact at PashionFootwear or another partner org); fallback path: a senior security engineer outside the Concierge maintainers.
2. Send them `docs/setup/workspace-admin-instructions.md` (rendered via the live GH Pages site at https://jstottlemyer.github.io/Concierge/setup/workspace-admin-instructions.html).
3. Capture their decision + any feedback in writing. If they would approve as-is, record the signoff in the release notes. If not, the feedback informs a doc revision before the release tag.

## H4 — `wiki-update` post-merge

Once H2 + H3 sign off and `release-v2.0.0` ships, invoke the `wiki-update` skill (or `/wrap` Phase 2c Step 2) to distill the build pattern into the Obsidian wiki at `~/Documents/Obsidian/wiki/projects/concierge/`. This captures the lessons learned (CI gotchas, threat-model decisions, the bootstrap architecture) for future projects.

## What is NOT release-blocking

The following items were noted during the build as worth-doing-eventually but are explicitly not gating `release-v2.0.0`:

- **`setup.sh.sha256` published over HTTPS** at `https://jstottlemyer.github.io/Concierge/setup.sh.sha256` (referenced from quickstart + onboarding docs). Needs a GH Pages publish step. **Risk:** the docs link 404s on day one for users following the paranoid-path verification. Workaround: users can compute the SHA from the public repo file directly (`shasum -a 256 scripts/setup.sh` after `gh repo clone`). Track as v2.0.1 cleanup.
- **`package-mcpb.yml` header comment** describes itself as the only release path; should add a "see also: release.yml" pointer once F1 is battle-tested. Cosmetic.
- **Cosign cert-identity pinning** (TODOs in `setup.sh` and `release.yml`) — pin to the workflow URL once `release.yml` has run cleanly through one or two real releases. Tightens the threat model from "any cosign cert" to "signed by this specific workflow."

## Build summary

- 6 PRs landed (#12 → #18, with #14 still open for unrelated CLAUDE.md gotchas)
- 47 of 49 tasks effectively shipped (H2 + H3 are the human-gated remainders)
- 1167 tests passing across the monorepo (725 gws + 81 core + 361 setup, with 4 more integration tests when CI runs with the gate on)
- Setup orchestrator binary (`@concierge/setup`), bash bootstrap, cosign signing, release workflow, all 5 user-facing docs, and the macos-14 integration test all on `main`
