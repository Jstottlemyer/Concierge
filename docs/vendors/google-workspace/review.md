# Google Workspace MCP — PRD Review

**Spec reviewed:** `docs/specs/google-workspace-mcp/spec.md`
**Date:** 2026-04-13
**Reviewers:** requirements · gaps · ambiguity · feasibility · scope · stakeholders

## Consolidated Verdict

**4 of 6 agents passed with notes. 2 failed (feasibility, stakeholders).**

Overall health: **Significant Concerns.** The spec is cohesive, principle-aligned, and well-scoped in spirit — but four load-bearing technical assumptions are not demonstrably supported by Claude Desktop + MCP today, and three stakeholder/governance questions (OAuth client ownership, upstream relationship, true revocation) can block launch. These must be resolved before `/plan`.

## Spec Strengths

- **Clear scope-bundle model** with explicit in/out-of-scope and a primary-bundle resolution table.
- **Strong Principle-III discipline** — no forked OAuth, no API reimplementation, all API calls route through `gws` subprocess.
- **Testable acceptance list** covering all five constitutional principles (even where individual criteria need sharpening).

## Must Resolve Before Planning

### 1. Feasibility spikes required for four load-bearing `.mcpb` / MCP claims

Each of these is asserted in the spec but not demonstrably supported by current Claude Desktop + MCP documentation:

- **`.mcpb` `server.type: binary` with per-arch bundled binaries.** The published `.mcpb` format documents `node` and `python` server types; binary with Anthropic-managed arch selection needs to be confirmed against the current manifest schema. *Action:* cite the manifest schema version this depends on, or run a spike with a minimal binary extension.
- **In-subprocess browser launch + loopback OAuth callback.** `gws auth login` requires spawning `open <url>` and binding a loopback port. macOS App Sandbox or Claude Desktop entitlements may block either. *Action:* spike — run a `.mcpb` that executes `open https://example.com` and binds a local port from inside a tool call; confirm both work end-to-end.
- **Runtime tool-list mutation for Read-Only mode.** Spec relies on MCP `notifications/tools/list_changed` — some hosts cache tool lists at session start. *Action:* confirm Claude Desktop honors `list_changed`, or redesign Read-Only as server-side rejection (tool stays visible, call errors).
- **Cross-binary keychain ACL sharing.** macOS keychain ACLs bind to the writing binary's code signature. Bundled `gws` inside `.mcpb` ≠ Homebrew `gws` → different signatures → OS will prompt "Always Allow" on every cross-binary read. This directly contradicts Acceptance §12 (terminal→Desktop parity) + §13 (ACL'd to Concierge binary). *Action:* verify ACL behavior empirically; redesign cross-surface parity via a shared config file + shared OS keyring entry (not binary-ACL'd) if needed.

### 2. OAuth client ownership is undecided

The spec never says who owns the Google Cloud project and OAuth client. Options:
- **Concierge-owned** — we run verification (CASA assessment for sensitive scopes), we own quota/abuse surface.
- **BYO (user provides `client_secret.json`)** — onboarding is terminal-ish, breaks "super user friendly" goal.
- **Inherit from `gws`** — `gws auth setup` creates a user-owned project; most compatible with cross-surface parity but still requires user to run `gws auth setup` once.

*Action:* pick one with rationale; document in Approach §. Without this, aggregate scope footprint (Gmail + Drive + Admin Reports + Classroom = mostly "restricted/sensitive") will hit the 100-user testing-mode cap for any non-developer stakeholder.

### 3. Revocation UX is incomplete for non-technical users

`remove_account` deletes the local token but the spec doesn't mandate a call to Google's token-revocation endpoint, nor surface "also revoke at myaccount.google.com" to the user. A homeowner-ish stakeholder will believe they're disconnected when they aren't. *Action:* specify that `remove_account` calls the revoke endpoint (`oauth2.revoke`) AND deletes keychain entries; add AC covering both.

### 4. Internal contradictions in counts and identifiers

Small, deterministic, must be fixed:
- **Shim-tool count:** Summary says "10 shims (~35 tools)"; Integration + Acceptance §4 say 12 shims (41 total). Use 12 everywhere.
- **Admin service identifier:** bundle-membership table uses "Admin Reports"; shim table uses `admin-reports`; primary-bundle table uses "Admin Reports". Pick one canonical string.
- **Primary-bundle table emphasis:** only multi-bundle services are bolded; single-bundle rows look unflagged. Either bold all, bold none, or add a "Multi-bundle?" column.
- **"Active account" vs "default account":** used interchangeably; `state.json` key is `default_account`. Pick one.

### 5. Read-Only mode mid-flight behavior undefined

Three gaps:
- What happens to an in-flight write call when `set_read_only(true)` toggles mid-call?
- Is the tool list re-published dynamically (depends on §1 feasibility spike) or cached?
- Does toggling Read-Only → off require re-consent (scopes were `.readonly`)?

*Action:* either define all three explicitly, or defer Read-Only to v1.1 (see Scope recommendation below).

## Should Address

### Scope trim recommendation

One reviewer argues the v1 surface is ~2× what's needed to prove dual-surface parity. Specific candidates:
- **Cut bundles to Productivity + Collaboration.** Education, Creator, Admin & Compliance, Automation have plausibly zero first-wave usage; defer to v1.1 when a user surfaces need. Removes ~half the scope-bundle test matrix and sidesteps some OAuth-verification scope footprint.
- **Defer Read-Only modifier to v1.1.** Orthogonal to core value; scopes in `gws` are already minimum-necessary.
- **Consider single-account v1.** `list_accounts` / `set_active_account` / `remove_account` / per-tool `account` param all disappear. Most Claude Desktop users have one Google account.
- **Trim shims to 5** (drive_list, drive_download, docs_read, docs_create, sheets_create), pushing Forms/Meet/Admin shims to v1.1.

Not a blocker — Justin has already made these product calls in /spec — but worth one explicit "yes, keep the larger v1" confirmation now that the feasibility risks are surfaced.

### Acceptance criteria need sharpening

- **Performance thresholds** from constitution (auth <3s, keychain <50ms, wrapper <100ms) missing from Acceptance.
- **Cross-surface parity test** (§12) has no concrete procedure.
- **Log-scan corpus** (§14) doesn't specify files/patterns.
- **Failure-mode criteria** (consent denied, expired-refresh, revoked account) not in Acceptance list despite rich Edge Cases coverage.
- **Keychain ACL ownership** (§13) likely wrong — `gws` writes entries, not Concierge.
- **`remove_account` residual-check** (§11) — add AC that `security find-generic-password` finds zero residuals after removal.

### Extension lifecycle gaps

- **Upgrade/migration:** What happens v1.0 → v1.1 with existing `state.json`, granted scopes, bundled `gws` binary? Define migration contract.
- **Bundled `gws` security patches:** How does the bundled binary get security updates? Define cadence + rebuild trigger.
- **Uninstall cleanup:** Removing `.mcpb` should do what to keychain entries, `~/.config/gws/`, `state.json`, Google-side grants? Define a "clean uninstall" contract.

### Upstream relationship

Spec adds 12 shims wrapping vendor methods and bundles the vendor binary. No mention of:
- License check (`gws` license, NOTICE file obligations)
- Coordination with `googleworkspace/cli` maintainers
- Contribute-back path for shims (spec has this as a Backlog item — elevate to Approach §)
- Bug-triage pattern when users report issues that originate in `gws`

### Concurrency & state

- **`state.json` atomicity** is claimed; **`gws` config file concurrency** is not. What if Claude CLI runs `gws auth login` while the MCP server triggers consent? Who wins?
- **Productivity bundle scope count** is close to the 25-scope testing-mode cap (Gmail + Drive + Calendar + Docs + Sheets + Tasks, 2–3 scopes each). Audit actual scope count before build.

### Glossary

"bundle", "scope", "service", and "active account"/"default account" drift across sections. Add a glossary paragraph at the top of the spec.

## Watch List

- Progress surfacing via MCP `notifications/progress` requires the originating `tools/call` to stay open; confirm synchronous consent-inside-tool-call design.
- `modelarmor_sanitize_*` tools match the "sanitize" write-class trigger — clarify whether they're suppressed under Read-Only.
- `gws_execute` has only the happy-path acceptance; consider one negative-path criterion.
- `GOOGLE_WORKSPACE_CLI_CONFIG_DIR` "left at default" — document as a non-override invariant.
- Accessibility for the progress message + Keychain unlock prompt (Anthropic directory submission may require).
- MDM-managed Macs may block keychain ACL widening or browser launch.
- State file permission mode — explicit `0600` vs `0644` for plan.
- Enterprise/IT-admin stakeholder absent from v1 (reasonable; flag explicitly in non-goals).
- QA needs two sandbox Workspace tenants for multi-account tests; spec mentions one.
- Rate-limit/backoff behavior if Claude loops a tool call.

## Reviewer Verdicts

| Dimension | Verdict | Key finding |
|---|---|---|
| Requirements | PASS WITH NOTES | Four AC items need sharpening (cross-surface test, perf thresholds, ACL ownership, log-scan scope) |
| Gaps | PASS WITH NOTES | Upgrade/migration, uninstall cleanup, support observability, concurrency |
| Ambiguity | PASS WITH NOTES | Shim count, admin identifier, Read-Only mid-flight, active/default naming |
| Feasibility | **FAIL** | Four load-bearing claims need spikes: `.mcpb` binary server type, in-subprocess browser launch, runtime tool-list mutation, cross-binary keychain ACL |
| Scope | PASS WITH NOTES | V1 surface ~2× minimum-viable; trimmable but Justin's call |
| Stakeholders | **FAIL** | OAuth client ownership, upstream maintainer relationship, true-revocation UX |

## Conflicts Resolved

- **Scope vs Stakeholders disagreement.** Scope recommended trimming to Productivity+Collaboration, single-account, 5 shims, no Read-Only. Stakeholders asked for *more* (per-bundle Read-Only, enterprise/MDM). Resolution: Scope's YAGNI argument is stronger for v1; Stakeholder's enterprise concerns belong in Backlog. The feasibility failures make trimming more attractive (less surface to risk).
- **Feasibility FAIL vs other PASS-WITH-NOTES.** Feasibility's four blockers are load-bearing — if they don't hold, the rest is moot. FAIL takes precedence; overall verdict is Significant Concerns, not PASS WITH NOTES.
- **Tool-count contradiction** flagged by 4 agents with identical recommendation. High convergence → this is real, fix in spec.

---

## Resolved (post-review Q&A + spec revision 2026-04-13)

All 5 critical items and all 4 important items resolved via Q&A (Q1–Q10) and applied to the spec. Summary:

| Finding | Resolution | Spec ref |
|---|---|---|
| **Critical: feasibility spikes** | Run spikes after Q&A and before `/plan`. If blocker found, loop back to spec. | Step 3 of final plan |
| **Critical: OAuth client ownership** | Inherit from `gws` (user-owned GCP project via `gws auth setup`). Concierge-owned verified client deferred to commercial v2. | Approach §, Out-of-Scope §, Pre-install UX § |
| **Critical: revocation UX** | `remove_account` calls `oauth2.revoke` (best-effort) + local delete, with two-call confirmation pattern. Added `factory_reset` tool. Management tool count 3 → 5. | Destructive Operations UX §, AC §14–17 |
| **Critical: internal contradictions** | Shim count now 12 everywhere (42 total MCP tools). `admin-reports` canonical (lowercase-hyphenated). Primary-bundle table has explicit Multi-bundle column. "Default account" everywhere (was "active"). | Glossary §, all tool sections |
| **Critical: Read-Only mid-flight** | In-flight writes complete; mode applies to new calls. Server-side rejection (no `list_changed` dependency). Toggle-off requires confirmation re-consent. | Read-Only UX §, AC §9–10 |
| **Important: scope trim** | Kept full v1 surface; Justin decision. Trim options remain in Backlog. | Scope §, user decision |
| **Important: AC sharpening** | Added P1–P3 performance, F1–F4 failure modes, §11a residual check, §S1 scope-count audit. Revised §12 cross-surface procedure, §13 ACL ownership (gws owns entries), §14 log-scan corpus. | AC §18–31 |
| **Important: extension lifecycle** | State-preserved upgrade with schema migrator. Uninstall is reversible local-delete only; `factory_reset` for irreversible cleanup. 48h security-patch SLA. | Upgrade/Uninstall UX §, AC §31 |
| **Important: upstream relationship** | Apache-2.0 LICENSE + NOTICE bundled in `.mcpb`. Maintainer outreach post-v1. Bug triage: include `gws --version` + verbose stderr in all errors. | Approach §, AC §30 |

### Watch-list items explicitly deferred (not blocking v1)

- Accessibility audit — backlog
- MDM / IT-admin features — backlog
- Observability / audit log — backlog
- Rate-limit / circuit-breaker — not currently warranted; trust `gws` exit codes
- Enterprise stakeholder — backlog
- Runtime `gws` version-check endpoint — replaced by 48h patch SLA

### Pending before `/plan`

- **Feasibility spikes** (four claims): `.mcpb` `server.type: binary` with per-arch paths, in-subprocess browser launch + loopback binding, cross-binary keychain ACL behavior. `notifications/tools/list_changed` is now informational only (we chose server-side rejection).
- Spike findings may tighten Integration § Manifest details or the cross-surface parity mechanism.
