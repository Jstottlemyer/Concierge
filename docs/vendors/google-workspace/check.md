# Google Workspace MCP — Plan Gap Checkpoint

**Spec:** `spec.md` · **Review:** `review.md` · **Spikes:** `spikes.md` · **Plan:** `plan.md`
**Date:** 2026-04-13
**Reviewers:** completeness · risk · scope-discipline · sequencing · testability

## Consolidated Verdict

**0 of 5 agents PASSED.** All 5 returned **REVISE**. No BLOCKs.

The plan is structurally sound and implementation-ready in spirit, but 5 convergent issues and ~15 smaller coverage gaps should be resolved before `/build` starts. None are architectural — all are sequencing, task-granularity, or test-harness gaps. A focused revision pass resolves them without changing any spec or design decision.

## Must Fix Before Build

### 1. Promote hands-on spikes to Phase 0 (convergent: risk + sequencing)

T21 (browser/loopback), T22 (keychain ACL), T23 (Gatekeeper) are currently Phase 6 but tagged "run first." This contradicts the plan's own recommendation. **Reorder:** new Phase 0 runs spikes before T1. If Spike 4 finds binary-identity doesn't hold, the UX error text and cross-binary copy must be drafted before T5's error envelope is frozen. 30 min of hands-on prevents weeks of rework.

### 2. Close the confirmation-token prompt-injection delivery gap (risk)

Current design: first call returns a token + human-readable warning; second call must include the token. **Risk:** Claude Desktop may pipeline tool results back to the model in the same turn without the human seeing the warning — model auto-emits the second call with the token before any human gate fires.

**Mitigation options (pick one in revision):**
- **(a) Require human-typed confirmation string** (e.g., type `yes, remove alice@example.com`) — not server-minted tokens. Strongest; most friction.
- **(b) Gate on MCP `elicitation/request` flow** — explicit user-input step supported by MCP spec. Medium friction.
- **(c) Add AC test that simulates a single-turn model round-trip and asserts the destructive op is NOT executed.** If Claude Desktop's current behavior already prevents it, this codifies the invariant.

Whichever: add a test task that verifies the control holds under single-turn pipelining.

### 3. Add regression guardrail to "pin latest at build time" (risk)

Current: CI fetches latest `gws` release, sha256-pins it. **Risk:** a buggy upstream release ships unnoticed. **Fix:** candidate version must pass full integration suite (T25 + T30) before the sha256 checksum is committed. Effectively "latest that passes our tests" — same pace, bounded blast radius. Add as a CI gate in T19.

### 4. Document out-of-band migration-recovery procedure (risk)

If MCP server fails to start (state schema too new, bundled binary blocked by Gatekeeper, corrupted state), user cannot `factory_reset` from inside Claude Desktop — it needs a live server. **Fix:** document in README + `state_schema_too_new` error message: "Delete `~/Library/Application Support/Claude/extensions/concierge/state.json` and run `gws auth logout --all` in Terminal, then restart the extension." Add to T32.

### 5. Add missing prerequisite + harness tasks (sequencing + testability)

Add before Phase 3 begins:
- **T7.5 — Capture `gws --help` + sample-response fixture corpus.** Feeds T11 schema extraction, T12 TDD fixtures, T28 log-scan known-token seed.
- **T11.5 — Shared `gws` subprocess mock harness** (fake binary on PATH + scripted response file). Load-bearing for T12 TDD and T30 failure-mode injection.
- **T18.5 — Commit initial `build/gws-checksums.txt`** with pinned version; CI reads from here, doesn't re-fetch.
- **T5.5 — Inject a clock abstraction** into the confirmation-token store. Required for T31 to test 60s TTL without real-time flakes.

## Should Address (important, non-blocking)

### Missing AC coverage — pin to specific tasks

| AC | Fix |
|---|---|
| §2 first-run single browser + no terminal | Add explicit E2E assertion to T25 |
| §15 keychain residual check post `remove_account` | Add `security find-generic-password` count assertion to T27 or T31 |
| §17 expired/reused token returns fresh `confirmation_required` | Add response-envelope assertion to T31 |
| §21 P1 perf with stat basis | T29 must define N≥30 samples, p95 assertion, warm-vs-cold split, runner class pinned |
| §28 scope-count CI regression guard | Add explicit CI failure test to T20 that appends a scope and expects T3 to fail |
| §31 48h CVE SLA | Add runbook test + documented procedure to T32/T33 |

### Missing edge-case + integration tests

- **Prompt-injection single-turn test** (risk #2 above) — assert destructive ops do not execute when Claude pipelines the confirmation response back to the model in one turn
- **`drive_share` cross-domain confirmation** (Open Q#3 resolution has no test) — fold into T31
- **`workflow_file_announce` union-scope consent** (Open Q#6 resolution has no test) — fold into T25
- **Keychain locked, no retry-loop** — add to T30
- **Arch-mismatch install behavior** — add to T19 or T23
- **`rate_limited` error with `retry_after_ms`** — add to T30
- **State file 64 KiB size cap + 0600 permission check + parent dir 0700** — add to T2 test suite

### Consistency fixes

- **Spec AC §4 tool names still read `drive_list`, `docs_read`, etc.** Plan renamed to `drive_files_list`, `docs_documents_get` per Design Decision #2. Update spec AC §4 to match (or plan must maintain the mapping and the rename lands inside T11 schema generation).
- **T14 Depends-on column** should list `T5, T7, T11, T12` (currently only T11/T12 — missing T5 for confirmation store and T7 for runner)
- **T28 allowlist regex** should be committed as a constant with a positive + negative fixture corpus (catch false positives scrubbing legitimate user content that happens to look token-shaped)
- **T17 Read-Only middleware** must depend on T11/T12/T13 since it reads their `readonly` attributes — plan currently lists only T4/T14
- **User-facing error-copy task missing.** 13 `error_code` values need consistent voice. Add to T32 or a new docs micro-task.

## Scope Discipline Flags (Justin's call — not auto-applied)

Scope-Discipline agent argued for cuts. Justin already approved the full v1 surface in earlier Q&A rounds, so these are *revisit* prompts, not mandatory:

- **T16 local rate limiter** — candidate cut (pass-through Google's 429s). Confirm keep or defer.
- **T15 pagination façade** — candidate simplify (pass `--page-all`, return full list). Confirm keep or simplify.
- **Per-account scopes cache (Design #9)** — candidate drop (keep only version cache). Justin's call.
- **`meet_create_space` shim** — candidate defer to v1.1 (space auto-created by Calendar events). Justin's call.
- **`admin_reports_*` shims (2)** — candidate defer given admin bundle is mocked-only in v1. Justin's call.

Scope-Discipline also suggested dropping `copyable_command` as a field (inline in message instead), but Justin approved it in Q5 as a general affordance — **keep**.

Risk agent raised that "pin latest at build" plus no regression guard is too loose — already folded into Must-Fix #3.

## Accepted Risks (documented, proceed)

- **v1 known gap: Admin & Compliance + Classroom bundles** have unit-test-only coverage. Real-tenant integration tests deferred until business users with Workspace domains are onboarded. Mock-fidelity drift detector (record/replay one real response per mocked tool) is a should-address item to prevent silent drift.
- **Apple notarization** not in v1. Unsigned `.mcpb` will hit Gatekeeper on first launch — documented via `gatekeeper_blocked` error and troubleshooting doc. $99/yr Developer ID + CI notarize is a backlog item.
- **Confirmation-token in-process only** — on MCP server crash mid-flow, tokens are lost and user must restart the confirmation. Acceptable given 60s TTL.
- **`auth.pid` probe TOCTOU window** — documented; same-user-UID trust domain makes this non-exploitable.

## Plan Readiness

**PROCEED AFTER REVISE.** No architectural blockers. 5 must-fixes + ~15 smaller gaps listed above. Estimated revision effort: 1–2 hours of plan edits + 5 new task entries. After revision, plan moves to `/build`.

---

## Revision Applied (2026-04-13)

All 5 must-fixes and ~15 should-addresses applied to `plan.md`. Summary:

### Must-Fixes — applied
1. **Spikes promoted to Phase 0** (T0.1 browser/loopback, T0.2 keychain ACL, T0.3 Gatekeeper, T0.4 sandbox tenants). Gate Phase 1. Justin executes at home before coding.
2. **Prompt-injection confirmation gap:** Decision #14 added — test-first adversarial assertion in T31; if gap confirmed, v1.1 escalates to MCP `elicitation/request`.
3. **Regression guard on "latest gws":** T19 CI pipeline requires candidate to pass T25+T30 before checksum commit. Decision #11 updated.
4. **Out-of-band recovery:** Decision #13 added; T32 documents terminal recovery sequence; `state_schema_too_new` error carries `copyable_command`.
5. **New prereq tasks:** T5.5 clock injection, T7.5 fixture capture, T11.5 subprocess mock harness, T18.5 checksum seed, T31.5 admin drift detector, T32.5 error-copy strings.

### Should-Addresses — applied
- AC §2 first-run assertion → folded into T25.
- AC §15 residual check → T27 (`remove_account` → zero keychain entries).
- AC §17 response-shape → T31.
- AC §21 perf stat basis → T29 (N≥30, p95, pinned runner class).
- AC §28 regression guard → T20 (append-scope-fails-CI test).
- AC §31 SLA runbook → T32.
- Missing edge-case tests (keychain_locked, arch mismatch, `drive_permissions_create` cross-domain, `workflow_file_announce` union, state 64 KiB cap, state perms) → distributed across T2, T19, T25, T30, T31.
- T14 Depends-on updated: `T5, T7, T11, T12`.
- T17 Depends-on updated: `T4, T11, T12, T13, T14`.
- T28 allowlist regex committed as constants with fixture corpus → T6 scope expanded.

### Scope Decisions (Justin's calls)
- T16 local rate limiter → **deferred to v1.1**.
- T15 pagination default → **50** (was 25).
- Per-account scopes cache → **dropped** (version cache only).
- `meet_create_space` shim → **kept**.
- `admin_reports_*` shims → **kept** (startup CEO persona needs audit).
- `copyable_command` → **kept as general envelope affordance**.

### Target User Clarification
- v1 persona: **startup CEO (PashionFootwear)**. Luna's Pavers removed from use-case consideration.
- Admin bundle remains important; mock-only v1 coverage accepted with T31.5 drift detector.

Plan revision complete. Ready for `/build`.
