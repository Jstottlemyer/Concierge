# Google Workspace MCP — Implementation Plan

**Created:** 2026-04-13 (post-/spec, post-/review, revised post-/check 2026-04-13)
**Spec:** `spec.md` · **Review:** `review.md` · **Spikes:** `spikes.md` · **Check:** `check.md`
**Target user:** startup CEO persona (PashionFootwear).

## Architecture Summary

Concierge ships as a **Node.js + TypeScript MCP server** packaged in a `.mcpb` extension for macOS. Claude Desktop provisions the Node runtime natively (no bundled runtime needed), so the `.mcpb` contains only the compiled TypeScript, a byte-identical bundled `gws` binary (fetched from upstream releases, sha256-pinned after integration-suite pass), and a `manifest.json` declaring `server.type: node`.

The server registers **40 MCP tools** (22 vendor helpers + 12 shims + 1 passthrough + 5 management). Calendar vendor helpers are intentionally omitted — claude.ai's hosted Calendar connector is strictly more capable than what Concierge could duplicate. Concierge and claude.ai's Google connectors coexist cleanly (no literal name collisions, complementary read-vs-action specialization). Tool invocations spawn `gws` as a one-shot subprocess per call (argv-array, `shell: false`). OAuth happens via `gws auth login` subprocess which owns the browser launch and loopback callback. Credentials live in `gws`'s OS-keyring + encrypted file store at `~/.config/gws/` — Concierge never writes keychain entries directly. Cross-surface parity is preserved because Concierge ships the exact same `gws` binary that Homebrew delivers (identical code signature → identical keychain ACL).

Concierge' own state (`state.json`, schema v1) holds only `default_account`, per-account `read_only` flags, and `state_schema_version`. Destructive operations require a human-typed canonical confirmation phrase (no server-minted tokens) — immune to single-turn tool-call pipelining. Read-Only is enforced via server-side rejection (no dependency on MCP `tools/list_changed` notifications).

## Key Design Decisions

### 1. Language: Node.js + TypeScript + `@modelcontextprotocol/sdk`
`server.type: node`; Claude Desktop supplies the runtime. Zod → JSON Schema for tool emission; Anthropic-maintained reference SDK; fastest 42-tool iteration.

### 2. Tool naming: hybrid
Vendor helpers keep short names (`gmail_send`); shims use `service_resource_verb` (`drive_files_list`, `docs_documents_get`, `admin_reports_activities_list`).

### 3. Parameter naming: snake_case-owned + camelCase-passthrough
Concierge params (`account`, `confirm`, `dry_run`, `readonly`) are snake_case. Google Discovery params ride inside `params: object` with camelCase passthrough. Shims surface 3–6 common params at top level (translated at subprocess boundary) plus `extra_params` escape hatch.

### 4. Error envelope: single shape
```typescript
{
  ok: false,
  error_code: "consent_denied" | "read_only_active" | "account_revoked"
           | "validation_error" | "auth_setup_needed" | "keychain_locked"
           | "confirmation_required" | "confirmation_expired" | "gws_error"
           | "auth_in_progress" | "network_error" | "gatekeeper_blocked"
           | "state_schema_too_new",
  message: string,                 // user-facing, scrubbed, non-jargon
  gws_version?: string,
  gws_stderr?: string,             // last 500 chars, redacted
  gws_exit_code?: number,
  confirmation_phrase?: string,    // canonical phrase user must type for destructive ops
  retry_after_ms?: number,         // reserved for v1.1 rate-limit; kept in schema
  next_call?: { tool: string, arguments: object },
  copyable_command?: string,       // e.g., "gws auth setup"
  docs_url?: string
}
```
Every error path goes through `makeError()` — no ad-hoc construction.

### 5. Confirmation pattern: **human-typed string** (not server-minted tokens)
**Decided post-/check:** Destructive ops require the user to type an exact human-readable phrase, not a server-generated token. This closes the prompt-injection single-turn-pipelining gap decisively — the confirmation phrase cannot appear in adversarial tool output by accident, and Claude cannot synthesize the exact string without the user having typed it.

Confirmation phrases (canonical, enforced by exact string match on the `confirm` parameter):

| Operation | Required confirm phrase |
|---|---|
| `remove_account(email)` | `remove <email>` (e.g., `remove alice@example.com`) |
| `factory_reset()` | `yes delete all my google credentials` |
| `set_read_only(enabled: false, account)` | `enable writes for <account>` |
| `drive_permissions_create` cross-domain | `share with <target_email>` |

First call (no `confirm` parameter): returns `error_code: "confirmation_required"`, `message: "<warning text>"`, and `confirmation_phrase: "<the exact phrase needed>"`. Claude relays both to the user; user types the phrase; Claude calls the tool with `confirm: "<phrase>"`.

**Why this beats tokens:** server-minted tokens can live in a single Claude turn's memory and be pipelined without the user seeing anything. A human-typed string requires a genuine turn boundary (user input). In the adversarial-email scenario, the attacker cannot author the confirmation phrase into their email content without the user separately agreeing and typing it — the phrase is context-dependent (`remove alice@example.com` wouldn't match `remove bob@evil.com`).

**Process: no in-memory token store needed.** Simpler implementation, smaller attack surface. T5.5 clock injection is no longer required for TTL tests (there is no TTL).

### 6. Subprocess safety
Argv-array invocation with `shell: false`. Validators: `service`/`resource`/`method` match `^[a-z][a-zA-Z0-9_-]{0,48}$`; `account` is RFC-5322-light email (≤254 chars); flag-prefix denylist (`--credentials`, `--config`, `--auth-override`). `gws_execute` writes `params`/`json` to a tempfile with `--params-file`, never inline.

### 7. State file
Single JSON, mode `0600`, parent dir `0700`, atomic tmp+rename (`writeSync → fsync → rename`). Lazy creation. Size cap 64 KiB (log + reject). Forward-only migrator. On failure: `state.json.bak.<timestamp>` backup + `state_schema_too_new` error with `copyable_command` pointing to out-of-band recovery (see Decision #13).

### 8. Log redaction
Allowlist regex scrubber on every outbound MCP `result` + `error.message`: `ya29\.[A-Za-z0-9_-]+`, `1//[A-Za-z0-9_-]+`, base64-JWT triple-dot, `client_secret[^\s]+`, `refresh_token[^\s]+`, `access_token[^\s]+` → `[REDACTED]`. Patterns committed as constants with positive + negative fixture corpus (guard against false positives on user content that happens to look token-shaped). CI gate.

### 9. Subprocess strategy
One fresh `gws` subprocess per tool call — no pool, no daemon mode. **Only `gws --version` is cached** (session lifetime). No scopes cache, no `state.json` snapshot cache — simpler correctness; re-query each tool call. Measured budget ~85ms baseline fits P3 <100ms with margin. Revisit if P3 benchmark fails.

### 10. Pagination (no v1 rate limiter)
All list shims default `max_results=50`, return `next_page_token` + `has_more`, opt-in `--page-all` passthrough. **Local rate limiter deferred to v1.1** — pass through Google's 429 `Retry-After` via `gws` stderr; no need to second-guess vendor quotas in v1.

### 11. Binary integrity + regression guard
CI fetches latest upstream `gws` release at build time; sha256-verifies against `build/gws-checksums.txt` (seeded via T18.5, updated per release PR). **Regression guard:** candidate version must pass integration suite (T25 + T30) before the checksum is committed. "Latest that passes our tests" — never blindly latest.

### 12. Read-Only enforcement: server-side rejection
No `tools/list_changed` dependency. While enabled for an account, any tool call with `readonly: false` (explicit per-tool attribute) returns `error_code: "read_only_active"`. Toggle-off requires explicit re-consent via the confirmation pattern.

### 13. Out-of-band recovery procedure
When MCP server itself fails to start (schema too new, bundled binary Gatekeeper-blocked, corrupted state), the user cannot use `factory_reset` from inside Claude Desktop. **Recovery path:** README and `state_schema_too_new` error's `copyable_command` field both point to a terminal sequence:
```
rm ~/Library/Application\ Support/Claude/extensions/concierge/state.json
gws auth logout --all
```
Then restart Claude Desktop. Documented in T32.

### 13.5 Tool-selection routing via description content (no MCP priority system)
**Background:** MCP has no tool-priority, source-ranking, or routing-rule system. When Claude Desktop has both Concierge and claude.ai's Google connectors loaded, Claude picks between overlapping-intent tools purely by name + description + input-schema semantic match. Confirmed empirically: the injection spike saw `read_next_email` lose to claude.ai Gmail's `gmail_read_message` because the native tool's description matched the read-intent better.

**Convention:** every Concierge tool description follows a 3-part pattern:

1. **What it does** — imperative, concrete verb as the first sentence. ("Sends a new Gmail message...")
2. **When to use** — explicit trigger-intent phrases matching likely user prompts. ("Use when the user asks to send, reply, or forward.")
3. **When NOT to use + routing hint** — short guidance pointing overlapping intents to the complementary surface. ("For reading, searching, or drafting email, prefer claude.ai's hosted Gmail connector.")

**Enforcement:** part of T11 / T12 implementation — tool registry declares description with all three parts or CI lint fails. Descriptions treated as user-facing product copy; T32.5 (error-copy task) extended to cover them.

**Sample canonical descriptions:**

- `gmail_send`: *"Sends a new Gmail message from the authenticated account. Use when the user asks to send, reply to, or forward an email. Returns the sent message ID. For reading, searching, drafting, or listing email, prefer claude.ai's hosted Gmail connector."*
- `drive_files_list`: *"Lists files in the user's Google Drive matching an optional query. Use when the user asks what files they have, to find a specific file by name, or to enumerate a folder. For semantic content search ('find docs about Q3 planning'), prefer claude.ai's hosted Drive connector."*
- `drive_upload`: *"Uploads a local file to Google Drive with optional metadata. Use when the user wants to put a file into Drive. Returns the uploaded file ID."* (no competing native tool — no routing hint needed)
- `forms_forms_create`: *"Creates a new Google Form. Use when the user wants a survey, quiz, or intake form. Returns the form URL."* (no competing native — no routing hint)

**Limitations of this approach:**

- Soft control. Claude's pick is probabilistic, not deterministic.
- An aggressive prompt or terse tool description on the other side can override.
- Users retain an explicit override: say "use authtools to ..." in the prompt.
- T31 regression should add tests confirming the expected tool fires for representative prompts (e.g., "send an email" → `gmail_send`; "read my inbox" → claude.ai connector if installed).

### 14. Prompt-injection: four layered defenses (empirically validated in Phase 0 T0.5 + T0.6)

**Defense stack (each layer independently catches the attack):**

1. **Claude's native resistance to tool-output-driven dispatch.** Under normal user prompts, Claude does not pipeline a call that is instructed solely by tool output content. Measured empirically in T0.5 (obvious imperative injection) and T0.6 (subtler ops-notification-style injection) — both resisted.
2. **Claude Desktop's tool-approval UI.** Discovered in T0.6 brute-force: every tool invocation shows the user an explicit allow/block dialog before the MCP server receives it. Even under adversarial user prompting, the user must click Allow. This is Claude Desktop native; Concierge does not implement it.
3. **Concierge human-typed-string confirmation (Decision #5).** For destructive ops (`remove_account`, `factory_reset`, `set_read_only(false)`, `drive_permissions_create` cross-domain), the user must type the exact canonical phrase as the `confirm` parameter. Defense against distracted-user click-through of layer 2's approval dialog. Especially important if user chose "Allow Always" for the tool.
4. **Content-pattern filter on tool outputs** (v1.1 backlog). Pre-redact suspicious instruction-like strings in tool outputs before they reach Claude. Defense-in-depth when a future model or context degrades layer 1.

**T31 regression asset:** `authtools-injection-spike-0.0.3.mcpb` (obvious injection) + `-0.0.4.mcpb` (subtler injection) are committed as assets. On `gws` version bumps or model/Desktop-version bumps, re-run both tests to detect if resistance regresses. Expected: passive-read prompt yields zero follow-on pipeline; brute-force prompt surfaces the approval dialog (test may need to assert the dialog fired via Claude Desktop's event log if accessible).

## Implementation Tasks

S = <1 day, M = 1–3 days, L = 3–5 days. All Phase 0 tasks gate Phase 1.

### Phase 0 — Hands-on gates (Justin executes at home before any coding)

| # | Task | Size |
|---|---|---|
| T0.1 | Spike 2: minimal `.mcpb` with `server.type: binary` (shell entry) — verify `open https://example.com` + `127.0.0.1:<port>` binding from MCP subprocess | S |
| T0.2 | Spike 4: cross-binary keychain behavior — `gws auth login` from Homebrew; read same keychain entry from a copy of `gws` in a different path; observe prompt | S |
| T0.3 | Gatekeeper probe: download upstream `gws` darwin release, run `spctl --assess`; note notarization state | S |
| T0.4 | Provision 2× `@gmail.com` personal test accounts for integration | S |

**Gate:** if T0.1/T0.2 find blockers, return to /spec with findings. Otherwise proceed to Phase 1.

### Phase 1 — Foundation

| # | Task | Depends | Size | Parallel? |
|---|---|---|---|---|
| T1 | Repo scaffolding: TypeScript, pnpm, tsconfig, Vitest, ESLint, `@modelcontextprotocol/sdk`, `zod`, `zod-to-json-schema` | T0.1, T0.2 | S | — |
| T2 | `state.json` v1 schema (Zod), loader, atomic writer, migrator framework, 64 KiB cap + perms (0600/0700) tests | T1 | S | with T3–T6 |
| T3 | Bundle + service constants (`src/bundles.ts`), scope-count audit test + CI regression-guard (AC §S1, §28) | T1 | S | with T2,T4–T6 |
| T4 | Tool registry types + Zod → MCP schema emitter | T1 | S | with T2,T3,T5,T6 |
| T5 | Error envelope helper `makeError()` + confirmation-phrase validator (exact-string match on canonical phrases per Decision #5) | T1 | S | with T2–T4,T6 |
| T6 | Log redaction module — allowlist regex as committed constants + positive/negative fixture corpus; CI fixture test | T1 | S | with T2–T5 |

### Phase 2 — Subprocess + OAuth

| # | Task | Depends | Size | Parallel? |
|---|---|---|---|---|
| T7 | `gws` subprocess runner: argv-array spawn, stderr capture, 30s timeout, version cache, input validators | T1, T5 | M | — |
| T7.5 | **Capture `gws --help` + sample-response fixture corpus** (all 19 services × common methods). Feeds T11 schema extraction, T12 TDD fixtures, T28 log-scan known-token seeds | T7 | S | after T7 |
| T8 | Progress-notification helper (5-stage auto-consent emitter, progressToken plumbing) | T1 | S | with T7 |
| T9 | Auto-consent flow: detect missing grant → spawn `gws auth login` → wait → retry | T7, T8 | M | — |
| T10 | Concurrent OAuth detect-and-defer via `~/.config/gws/auth.pid` probe | T7 | S | with T9 |

### Phase 3 — Tool implementations

| # | Task | Depends | Size | Parallel? |
|---|---|---|---|---|
| T11 | 22 vendor-helper tools: schema generated from T7.5 fixtures; TDD with golden-response tests. (Calendar helpers dropped; see Architecture §) | T4, T7, T7.5 | M | with T11.5, T12 |
| T11.5 | **Shared `gws` subprocess mock harness** (fake binary on PATH reading scripted responses from env/file). Load-bearing for T12 TDD + T30 fault injection | T7, T7.5 | S | with T11, T12 |
| T12 | 12 Concierge shim tools (TDD): `drive_files_list`, `drive_files_download`, `drive_permissions_create`, `docs_documents_get`, `docs_documents_create`, `sheets_spreadsheets_create`, `chat_spaces_list`, `meet_spaces_create`, `forms_forms_create`, `forms_responses_list`, `admin_reports_activities_list`, `admin_reports_usage_get`. Includes `drive_permissions_create` cross-domain confirmation logic | T4, T7, T7.5, T11.5 | M | with T11 |
| T13 | `gws_execute` passthrough: validation, params-via-tempfile, readonly gate | T4, T7 | S | after T11/T12 |
| T14 | 5 management tools: `list_accounts`, `set_default_account`, `remove_account`, `factory_reset`, `set_read_only` with confirmation pattern | T5, T7, T11, T12 | M | after T11/T12 |

### Phase 4 — Pagination + Read-Only

| # | Task | Depends | Size | Parallel? |
|---|---|---|---|---|
| T15 | Pagination façade: `max_results=50` default / `next_page_token` / `has_more` for all list tools | T11, T12 | S | with T17 |
| T17 | Read-Only server-side rejection middleware (checks tool's `readonly` attribute + `state.accounts[email].read_only`) | T4, T11, T12, T13, T14 | S | with T15 |

*(T16 local rate limiter deferred to v1.1 per scope decision.)*

### Phase 5 — Packaging + CI

| # | Task | Depends | Size | Parallel? |
|---|---|---|---|---|
| T18 | `manifest.json` template: `server.type: node`, compatibility block, per-arch entry | T1 | S | with T18.5 |
| T18.5 | **Commit initial `build/gws-checksums.txt`** with pinned gws version; CI reads from here | T0.3, T18 | S | with T18 |
| T19 | CI pipeline (GH Actions hybrid matrix): ubuntu for lint/unit/build; macOS for `.mcpb` pack (fetch gws → sha256-verify → bundle → per-arch artifacts). **Regression guard:** candidate gws version must pass T25 + T30 before checksum is committed | T18, T18.5 | M | after T1–T14 |
| T20 | CI gates: LICENSE + NOTICE presence, sha256 invariant, scope-count audit (feeds from T3), scope-count regression test (add scope → T3 fails) | T3, T19 | S | with T19 |

### Phase 6 — Packaged integration checks

| # | Task | Depends | Size | Parallel? |
|---|---|---|---|---|
| T23 | Gatekeeper prompt check for the packaged `.mcpb` (different from T0.3 probe on raw tarball) | T19 | S | after T19 |

### Phase 7 — Integration + E2E testing

| # | Task | Depends | Size | Parallel? |
|---|---|---|---|---|
| T25 | Integration tests (Productivity bundle end-to-end, using T0.4 sandbox accounts). Includes explicit **first-run assertion** (AC §2: single browser window, no terminal interaction), **`workflow_file_announce` union-scope consent** (Open Q#6), **arch-mismatch install behavior** | T11, T12, T14, T0.4 | L | — |
| T26 | Cross-surface parity (AC §18): terminal → Desktop AND reverse direction, both asserted; keychain entry count + ACL list unchanged | T25 | M | with T27, T28 |
| T27 | Keychain hygiene (AC §19) — ACL, accessibility class, **residual-zero after `remove_account`** (AC §15) | T25 | S | with T26, T28 |
| T28 | Log-scan test (AC §20) — full-session grep corpus using T6 constants, zero token matches | T6, T25 | S | with T26, T27 |
| T29 | Performance benchmarks: **N≥30 samples, assert p95**, warm-vs-cold split, runner class pinned. P1 auth <3s, P2 keychain <50ms, P3 wrapper <100ms | T25 | M | — |
| T30 | Failure-mode tests using T11.5 mock harness: F1 consent_denied (≤2s), F2 expired+refresh_fail (≤10s), F3 account_revoked, F4 gws_execute validation. Plus: **keychain_locked no-retry-loop**, **`state_schema_too_new` recovery path** | T25, T11.5 | M | with T29 |
| T31 | Confirmation-phrase E2E: exact-string matching, case-sensitivity rules, whitespace handling, per-op phrase table. Steerability regression: install `authtools-injection-spike-0.0.3.mcpb` (baseline PASS captured Phase 0 T0.5), run canonical prompt, assert log shows zero follow-on pipeline. **`drive_permissions_create` cross-domain confirmation** (Open Q#3) | T14, T25 | M | with T29, T30 |
| T31.5 | **Admin-bundle mock fidelity:** record one real-tenant response per admin tool from a CEO's future Workspace access when available; commit as fixture; CI drift detector flags if `gws` version bump changes response shape. In v1, seed with upstream fixture from `gws` test suite if available | T11, T12 | S | after T11/T12 |

### Phase 8 — Docs + release

| # | Task | Depends | Size | Parallel? |
|---|---|---|---|---|
| T32 | README + troubleshooting doc: Gatekeeper hand-off, `gws auth setup` bootstrap, factory_reset vs uninstall, **out-of-band recovery procedure** (Decision #13), **48h CVE SLA runbook** (AC §31). **Imports `docs/setup/user-onboarding.md`** (already written during Phase 0 from real-world setup experience) | — | S | anytime |
| T32.5 | User-facing error-copy authoritative strings for all 13 `error_code` values (shared voice, one file) | — | S | anytime |
| T33 | Manual verification checklist for each release (includes T25 first-run, T26 parity, T29 perf sanity) | T25 | S | anytime |
| T34 | Release engineering: tag, CI artifact verification, GitHub Releases draft, **T33 checklist gate** on release | T19, T25, T33 | S | after T25, T33 |

**Parallel-execution map (solo dev):**

- **Phase 0** (T0.1–T0.4) at home, single sitting, ~30 min hands-on + tenant provisioning.
- Phase 1 T2–T6 parallel after T1.
- Phase 2 T7+T8 parallel; T9+T10 parallel; T7.5 follows T7.
- Phase 3 T11+T11.5+T12 parallel after T7.5; T13/T14 after.
- Phase 4 T15+T17 parallel.
- Phase 5 T18+T18.5 parallel; T19 after.
- Phase 7 T26/T27/T28 parallel; T29/T30/T31 parallel; T31.5 anytime post-T12.
- Phase 8 anytime.

**Critical path ~20–30 working days** for a focused solo dev. T25 L-size is the choke point; Phase 7 parallelism helps.

## Open Questions — Resolved (2026-04-13 Q&A)

1. **`gws` version:** Pin latest-at-build-time, sha256-verified, gated by integration suite passing before checksum commit.
2. **Sandbox tenants:** 2× `@gmail.com` personal accounts. **v1 known gap:** Admin & Compliance + Classroom bundles have unit-test + mock coverage only — real-tenant coverage deferred until CEO Workspace onboarding. T31.5 drift detector guards fidelity.
3. **`drive_share` cross-domain:** require confirmation when target domain ≠ source; reuses confirmation-token pattern. Backlog: content-pattern injection filter on tool outputs.
4. **CI runner:** GH Actions hybrid — ubuntu for lint/unit/build, macOS for pack + integration.
5. **`copyable_command`:** general affordance in error envelope (v1 used by `auth_setup_needed`, `state_schema_too_new`; `gatekeeper_blocked` uses `docs_url`).
6. **Composite `workflow_*`:** combined union-of-scopes consent in one OAuth prompt.
7. **Scope trim decisions:** T16 rate limiter → deferred to v1.1; T15 pagination default = 50; per-account scopes cache → dropped; `meet_create_space` → kept; `admin_reports_*` shims → kept (startup CEO persona needs audit/usage reports).

## Risk Register

| Risk | Blast radius | Likelihood | Mitigation |
|---|---|---|---|
| **Prompt-injection via tool outputs** pipelined in a single Claude turn | High (if user rubber-stamps) | Low (Claude Desktop tool-approval UI requires explicit per-invocation allow, confirmed T0.6) | Layered: (1) Claude's native resistance, (2) Claude Desktop approval UI, (3) human-typed confirmation phrase for destructive ops; v1.1 content filter for defense-in-depth |
| **Upstream `gws` regression slipping into release** | High (42 tools break) | Medium | Regression guard (Decision #11) in T19 — candidate must pass T25+T30 before checksum commit |
| **Gatekeeper blocks bundled `gws`** | Medium (user friction) | Medium | T0.3 probe; documented `gatekeeper_blocked` UX with `docs_url` to System Settings |
| **P3 budget exceeded on Intel Macs** | Medium (spec violation) | Medium | T29 stat-based benchmark (p95, N≥30); subprocess pool as backlog if violated |
| **Admin bundle drift between `gws` versions (mocks only)** | Medium (shipped untested-in-prod) | Low | T31.5 drift detector + release notes marker `[UNVERIFIED-REAL-TENANT]` on admin tools |
| **MCP server fails to start → user cannot `factory_reset`** | Medium (recovery dead-end) | Low | Out-of-band recovery procedure (Decision #13); documented in T32, surfaced in error `copyable_command` |
| **State migration failure mid-upgrade** | Low (file backed up) | Low | Backup + `state_schema_too_new` error + out-of-band recovery |
| **Cross-binary keychain ACL prompt** | None | None | T0.2 confirmed: keyring crate stores entry with user-level accessibility, not binary-locked ACL. Different gws binaries share the keychain entry without prompting. Binary-identity is no longer required for v1. |
| **Apple notarization absent** | Low (T0.1 spike confirmed Claude Desktop transparently handles ad-hoc-signed bundled binaries) | Low | `gatekeeper_blocked` error path preserved as defense-in-depth; Developer ID + notarize pipeline remains backlog if distribution moves outside Claude Desktop |
| **Claude Desktop `notifications/progress` inconsistent** | Low (worse UX) | Low | Progress is best-effort; tool call still completes |
| **Rogue local process writes to `~/.config/gws/`** | Medium | Low | Same user-UID trust domain as Desktop; documented, not an Concierge control boundary |

## Testing Discipline

- **TDD** for all 12 shim tools (T12 tests written before handlers using T11.5 mocks + T7.5 fixtures)
- **Integration tests** against T0.4 sandbox (Productivity bundle full real-path; admin bundle mocked)
- **Stat-based perf benchmarks** (T29: N≥30, p95, both arches)
- **Failure-mode tests** with fault injection via T11.5 mock harness (T30)
- **Confirmation-phrase E2E + non-destructive steerability probe** (T31)
- **Prompt-injection adversarial test** (T31 per Decision #14)
- **Log-redaction CI gate** (T6 → T28) — committed fixture corpus, zero token matches
- **Scope-count regression gate** (T3 → T20) — appending a scope fails CI
- **Admin-bundle drift detector** (T31.5) — response-shape change triggers review
- **Manual verification checklist** (T33) gates each release (T34)

## Consolidated Verdict

Plan is implementation-ready after post-/check revision. All 5 must-fixes and ~15 should-addresses applied. Spikes (Phase 0) gate Phase 1 — Justin runs them at home before coding begins. Total 39 tasks across 9 phases; solo-dev critical path ~20–30 working days.
