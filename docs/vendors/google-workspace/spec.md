# Google Workspace MCP Spec

**Created:** 2026-04-13
**Last revised:** 2026-04-13 (post-/review)
**Constitution:** Concierge v1.0
**Confidence (final):** Scope 0.95 · UX 0.93 · Data 0.93 · Integration 0.92 · Edge cases 0.90 · Acceptance 0.93

## Summary

Concierge v1 is a **Claude Desktop Extension (`.mcpb`)** that brings Google Workspace into Claude Desktop by wrapping the `gws` CLI (`googleworkspace/cli`). It ships as a one-click install bundle, reuses `gws`'s encrypted OS-keychain-backed credentials, and exposes **40 typed MCP tools** (22 vendor helpers + 12 Concierge-authored shims + 1 generic passthrough + 5 management tools).

**Positioning vs claude.ai's hosted connectors:** Concierge is explicitly complementary to claude.ai's Google connectors (Gmail / Calendar / Drive), which are remote services hosted by Anthropic. The native connectors are **read/search/analyze**-focused (hosted convenience, simpler setup, data flows through Anthropic). Concierge is **action/write**-focused and **strictly local** (your own GCP project, your own keychain, data never leaves your Mac). Tools from the two surfaces can coexist without name collisions; see User Onboarding doc for guidance on picking one vs the other. Claude CLI users already get full Google Workspace support via the vendor's upstream skills — Concierge adds the missing Desktop surface so Principle I (Dual-Surface Parity) is satisfied from v1. OAuth client ownership is **inherited from `gws`** (user-owned Google Cloud project per `gws auth setup`), sidestepping app-verification burden.

## Glossary

Terminology used throughout this spec:

- **Service** — a Google Workspace API surface (e.g., `gmail`, `drive`, `admin-reports`). Matches the first segment of `gws` CLI commands.
- **Scope** — a Google OAuth scope URL (e.g., `https://www.googleapis.com/auth/gmail.send`). Services have multiple scopes.
- **Bundle** — an Concierge grouping of services (e.g., `productivity`). Granting a bundle requests all its services' scopes in one OAuth round-trip.
- **Tool** — an MCP tool exposed to Claude. Each tool declares its service and a `readonly: true|false` flag. Bundle eligibility is derived from service membership.
- **Default account** — the account used when a tool call omits the `account` parameter. Persisted in `state.json` under `default_account`.
- **Primary bundle** — for a service that appears in multiple bundles, the bundle requested first when no containing bundle is granted yet.

## Scope

### In Scope (v1)
- A single `.mcpb` bundle for **macOS** (darwin-arm64 + darwin-x64) that:
  - Bundles `gws` binaries (per-arch) inside the extension
  - Ships a small MCP server that orchestrates `gws` subprocess calls and OAuth flow
  - Defines 6 scope bundles + Read-Only modifier
  - Supports multiple Google accounts with an explicit selector
  - Auto-triggers OAuth consent with progress surfacing on the first tool call in an ungranted bundle
- 22 named MCP tools mirroring vendor helper commands (Gmail, Sheets, Docs, Chat, Drive, Apps Script, Workflow, Events, Model Armor — Calendar vendor helpers dropped; see Approach §)
- 12 Concierge-authored shim tools filling coverage gaps
- 1 generic passthrough tool `gws_execute` for any Discovery method
- 5 management tools: `list_accounts`, `set_default_account`, `remove_account`, `factory_reset`, `set_read_only`
- Cross-surface credential parity: tokens granted in terminal via `gws auth login` are readable by the MCP server and vice versa
- `gws` version + verbose stderr included in every error response so users can self-serve upstream bug reports
- 48h SLA for security-patched re-release when a CVE lands in `gws` or its deps

### Out of Scope (v1)
- Linux/Windows support (constitution: macOS-first v1)
- Hosted auth service / custom connector (violates Principle II)
- Electron standalone app (`.mcpb` already delivers the same UX)
- Concierge-owned Google Cloud project with OAuth verification (commercial v2 path; not a v1 business)
- "Personal" lightweight bundle variant or user-customizable bundle taxonomy
- Smart account inference (using message fields like `from:` to pick account)
- Per-tool audit log
- Claude Code–specific packaging (users install upstream `googleworkspace/cli` skills directly via `npx skills add`)
- Accessibility audit for Anthropic directory submission (watch list, not v1 blocker)
- MDM / IT-admin managed deployment (backlog)
- Runtime `gws`-version check endpoint (`48h SLA via release cadence` is the v1 patch mechanism)

### Deferred to Backlog
See `docs/specs/constitution.md` Backlog section. Items most likely to promote from this spec: Electron app, cross-platform keychain, contributing Concierge shim tools upstream, Concierge-owned verified OAuth client, enterprise/MDM, per-bundle Read-Only granularity, prefer-PATH-`gws` toggle, tool-level audit log.

## Approach

**Chosen approach: `.mcpb` extension wrapping `gws` end-to-end.** No forked OAuth, no custom auth server, no reimplementation of Google API surface. Concierge is a thin orchestration layer between Claude Desktop and the vendor CLI.

### Key design decisions (from /review)

1. **OAuth client ownership: inherit from `gws`** — user runs `gws auth setup` once (creates a user-owned Google Cloud project via `gcloud`); Concierge reads that configuration. No app verification burden on Concierge.
2. **Destructive operations are confirmation-guarded** — `remove_account` and `factory_reset` use a two-call pattern: first call returns a confirmation token + human-readable warning; second call with the token within 60s executes.
3. **Read-Only mode uses server-side rejection, not runtime tool-list mutation** — write tools stay visible in Claude Desktop's tool list; invocations fail with `error_code: "read_only_active"` while mode is on. Removes dependency on `notifications/tools/list_changed` host support.
4. **`readonly: true|false` is an explicit tool attribute**, not a regex match on tool names. Enables unambiguous classification (e.g., `modelarmor_sanitize_*` are `readonly: true` preprocessors).
5. **Bundled `gws` binary is authoritative in v1** — 48h security-patch SLA via release cadence; PATH-`gws` preference deferred to v1.1.
6. **License compliance via NOTICE bundling** — `gws` is Apache-2.0; its LICENSE and NOTICE files are included in the `.mcpb`.
7. **Upstream coordination post-v1** — ship first, then reach out to `googleworkspace/cli` maintainers to offer Concierge shims for upstreaming.

### Why this approach

| Principle | How this approach satisfies it |
|---|---|
| I — Dual-Surface Parity | CLI uses upstream vendor skills unchanged; Desktop uses `.mcpb`. Both share credentials via `~/.config/gws/` + OS keyring. |
| II — Credential Safety by Default | `gws` encrypts credentials at rest (AES-256-GCM) with the key in OS keyring (macOS Keychain). Zero plaintext on disk. Destructive ops are confirmation-guarded. |
| III — Wrap, Don't Rewrite | Every tool call ultimately executes `gws <service> <method>`. We own orchestration, not the auth flow or API surface. |
| IV — Pattern over One-Offs | The `.mcpb` + shim-tools + bundle-scopes + confirmation-guarded-destructive pattern is reusable for future integrations. |
| V — Least Privilege, Visible Scope | Scopes are requested per-bundle at first use. Read-Only toggle-off requires explicit re-consent (no silent scope upgrades). |

### Alternatives considered and rejected

- **Self-implemented OAuth in MCP** — violates III, duplicates vendor work, creates drift risk.
- **Hosted service with custom connector** — requires infrastructure, violates II.
- **Concierge-owned verified OAuth client** — right for a commercial product, wrong for v1 (real money + months of review + ongoing compliance surface).
- **Runtime tool-list mutation for Read-Only** — depends on unverified host support for `list_changed`; server-side rejection is simpler and more portable.
- **Regex-based write-class detection** — fragile; explicit `readonly` attribute is deterministic.

## UX / User Flow

### Pre-install (one-time, new users only)

If the user has never run `gws` before, they need a Google Cloud project and OAuth client. The `.mcpb` on first launch detects missing `gws` configuration and surfaces a helper message:

> "One-time Google Cloud setup needed. Open Terminal and run `gws auth setup` (requires `gcloud`). Or, if you already have a client_secret.json, drop it at `~/.config/gws/client_secret.json`. Once done, retry this tool call."

Terminal-literate users who already use `gws` skip this step entirely.

### First-run (gws configured, zero granted bundles)

1. User downloads `Concierge.mcpb` from release page (or Anthropic directory).
2. Double-click → Claude Desktop installs → extension appears in extension list.
3. User asks Claude: *"List my most recent Drive files."*
4. Claude invokes `drive_list` (service: drive → primary bundle: productivity).
5. MCP detects no granted bundle containing `drive`; auto-triggers `gws auth login --scopes <productivity-scopes>`.
6. MCP surfaces progress via MCP `notifications/progress` against the originating tool call: *"Opening browser for Google consent (Productivity bundle)..."*
7. Browser opens to Google consent screen showing Productivity-bundle scopes only.
8. User consents. Callback lands. Token encrypted to keychain by `gws`.
9. MCP retries `drive_list`, returns results to Claude.
10. Subsequent Productivity tool calls require no further consent.

### Growing into another bundle

1. Later, user asks: *"Send a message to #team in Chat."*
2. Claude invokes `chat_send` (service: chat → primary bundle: collaboration).
3. MCP detects Collaboration not granted for the default account; auto-triggers consent flow.
4. Progress message: *"Opening browser for Google consent (Collaboration bundle: Chat, Meet, People)..."*
5. User consents, token updated, `chat_send` retries and succeeds.

### Multi-account

- `list_accounts` — lists all granted accounts with per-account granted bundles.
- Every tool accepts an optional `account: <email>` parameter; omitted uses `default_account` from `state.json`.
- `set_default_account(email)` changes the default.
- `remove_account(email, confirm?)` is confirmation-guarded (see Destructive Operations below).

### Destructive operations (human-typed confirmation)

Destructive ops require the user to type an exact canonical phrase as the `confirm` parameter. No server-minted tokens — the phrase is fixed per operation and per target. This forces a genuine turn boundary (user input) and makes the defense impervious to single-turn tool-call pipelining driven by adversarial tool output.

**Canonical phrases:**

| Operation | Required `confirm` phrase |
|---|---|
| `remove_account(email)` | `remove <email>` (e.g., `remove alice@example.com`) |
| `factory_reset()` | `yes delete all my google credentials` |
| `set_read_only(enabled: false, account)` | `enable writes for <account>` |
| `drive_permissions_create` cross-domain | `share with <target_email>` |

**Flow:**

1. **First call** (no `confirm`): returns `error_code: "confirmation_required"`, a `message` with human-readable warning, and `confirmation_phrase: "<the exact phrase needed>"`. Claude relays the warning and phrase to the user.
2. **Second call** with `confirm: "<exact phrase>"`: validates the phrase (exact match, case-sensitive, whitespace-normalized) and executes.

Scopes:
- `remove_account(email)` — calls `oauth2.revoke` for both access and refresh tokens (best-effort; warns on failure but still deletes local), then deletes keychain entries for that account.
- `factory_reset()` — calls `remove_account` for every account, deletes `state.json`, returns Concierge to zero-state. Does not uninstall the `.mcpb`.

No in-memory token store needed — the phrase validator is a pure function over the request.

### Read-Only mode

- `set_read_only(enabled: bool, account?: string)` toggles mode per account (or for the default account if omitted).
- **Rule:** while mode is on for an account, any tool call with `readonly: false` (on that account) returns `error_code: "read_only_active"` without invoking `gws`. The tool list itself does not change.
- **In-flight writes:** a tool call already dispatched to `gws` when `set_read_only(true)` is called is allowed to complete. Mode applies to *new* invocations.
- **Toggle-off (Read-Only → false):** requires explicit re-consent if the account's granted scopes are `.readonly` variants. `set_read_only(false)` returns a confirmation-pattern response: *"Disabling Read-Only requires re-consenting to writable scopes for `<bundle>`. Call `set_read_only(enabled: false, confirm: '<token>')` to proceed."* On confirm, triggers the OAuth flow with full (non-readonly) scopes.

### Uninstall vs factory reset

Two distinct paths, since `.mcpb` uninstall is managed by Claude Desktop, not Concierge:

- **Uninstall (Claude Desktop → remove extension):** extension files deleted; `state.json` and `~/.config/gws/` untouched; keychain entries remain. Reinstall restores everything including default account and granted bundles.
- **`factory_reset()` (Concierge tool, confirmation-guarded):** revokes all Google-side access, deletes all keychain entries + `state.json`. Leaves `.mcpb` installed for immediate re-onboarding.

A user who wants full removal calls `factory_reset` then uninstalls the extension.

### Extension upgrade

- On `.mcpb` update, Claude Desktop swaps binaries; the new MCP server starts against the existing `state.json`.
- State schema is versioned (`state_schema_version` field in `state.json`). On mismatch, migrator runs at MCP startup and writes back the updated schema.
- Granted scopes are lazily re-validated on next tool call (standard expired-token refresh flow handles this).
- Bundled `gws` binary upgraded as part of the `.mcpb` swap — same path, new binary. Keychain ACL considerations: see Edge Cases.

## Data & State

### What Concierge persists

| Data | Location | Notes |
|---|---|---|
| OAuth access/refresh tokens | Keychain via `gws` (AES-256-GCM, OS keyring) | Sole source of credential truth |
| Per-account granted scopes | Derived from token metadata (`gws` tracks) | Not separately persisted |
| `default_account` | Extension data directory (JSON file) | User preference, not sensitive |
| Per-account Read-Only mode | Extension data directory (same JSON file) | User preference |
| `state_schema_version` | Extension data directory (same JSON file) | For upgrade migrations |
| Confirmation phrases | Code-literal constants | Canonical exact-match phrases per destructive op; no runtime state |
| Cached `gws --version` check | In-memory per process | Avoids repeated subprocess launches |

No call audit log in v1. No telemetry. No user identifiers leave the device.

### State file format

```json
{
  "state_schema_version": 1,
  "default_account": "alice@example.com",
  "accounts": {
    "alice@example.com": { "read_only": false },
    "alice.work@company.com": { "read_only": true }
  }
}
```

Path: `<claude-desktop-extension-data-dir>/authtools/state.json`. File permissions: `0600` (owner-only read/write). No secret material, but restrictive permissions avoid future regressions if additional fields are added.

Writes are atomic (write to temp file, `rename(2)`).

### Scope bundle → Google OAuth scope mapping

Maintained in-code as constants. Each bundle maps to a display name and a list of scope URLs. **Tools declare a `service`, not a bundle** — a tool is usable if any granted bundle contains that service.

#### Bundle membership

| Bundle | Display name | Services |
|---|---|---|
| `productivity` | Productivity | gmail, drive, calendar, docs, sheets, tasks, **forms** |
| `collaboration` | Collaboration | chat, meet, people |
| `admin` | Admin & Compliance | admin-reports, events, modelarmor |
| `education` | Education | classroom, forms, meet |
| `creator` | Creator | slides, forms, docs, drive |
| `automation` | Automation | script, events, drive |

Each bundle is audited to fit under the 25-scope testing-mode cap with 1-scope headroom (see AC §S1).

#### Primary-bundle resolution

When a tool is invoked whose service is in no granted bundle, Concierge requests the service's primary bundle. Productivity is preferred where applicable (reflects common usage).

| Service | Primary bundle | Other bundles | Multi-bundle? |
|---|---|---|:-:|
| gmail | productivity | — | No |
| drive | productivity | creator, automation | Yes |
| calendar | productivity | — | No |
| docs | productivity | creator | Yes |
| sheets | productivity | — | No |
| tasks | productivity | — | No |
| chat | collaboration | — | No |
| meet | collaboration | education | Yes |
| people | collaboration | — | No |
| admin-reports | admin | — | No |
| events | admin | automation | Yes |
| modelarmor | admin | — | No |
| classroom | education | — | No |
| forms | productivity | education, creator | Yes |
| slides | creator | — | No |
| script | automation | — | No |

If any containing bundle is already granted for the active account, the tool works with no new consent.

## Integration

### Process architecture

```
Claude Desktop
    │
    ├─ spawns MCP server (binary inside .mcpb) over stdio
    │     │
    │     ├─ spawns `gws auth login` (subprocess) for OAuth flows
    │     ├─ spawns `gws <service> <method>` (subprocess) for API calls
    │     └─ reads/writes state.json (extension data dir)
    │
    └─ (Claude Desktop also manages its own extension-runtime secret storage,
         independent of gws; Concierge does not use it)
```

The MCP server is stdio-transport only. No HTTP. No sockets. OAuth loopback binding happens inside the `gws auth login` subprocess, not in the MCP server itself.

### Tool inventory

Every tool declares (a) a `service`, (b) a `readonly: true|false` attribute, (c) a typed input/output schema.

**Vendor helpers (22)** — wrapped 1:1 with typed schemas derived from `gws <helper> --help`:

| Tool | Service | Readonly |
|---|---|:-:|
| `gmail_send` | gmail | false |
| `gmail_reply` | gmail | false |
| `gmail_reply_all` | gmail | false |
| `gmail_forward` | gmail | false |
| `gmail_triage` | gmail | true |
| `gmail_watch` | gmail | true |
| `sheets_append` | sheets | false |
| `sheets_read` | sheets | true |
| `docs_write` | docs | false |
| `chat_send` | chat | false |
| `drive_upload` | drive | false |
| `script_push` | script | false |
| `workflow_standup_report` | workflow (composite) | true |
| `workflow_meeting_prep` | workflow (composite) | true |
| `workflow_email_to_task` | workflow (composite) | false |
| `workflow_weekly_digest` | workflow (composite) | true |
| `workflow_file_announce` | workflow (composite) | false |
| `events_subscribe` | events | false |
| `events_renew` | events | false |
| `modelarmor_sanitize_prompt` | modelarmor | true |
| `modelarmor_sanitize_response` | modelarmor | true |
| `modelarmor_create_template` | modelarmor | false |

Composite `workflow` tools inherit scope requirements from all their constituent services (Gmail + Calendar + Drive + Tasks + Chat in various combinations); granting Productivity typically suffices, with Chat-touching workflows needing Collaboration too.

**Concierge-authored shim tools (12)** — thin typed wrappers around `gws` Discovery methods:

| Tool | Service | Readonly | Wraps |
|---|---|:-:|---|
| `drive_files_list` | drive | true | `gws drive files list` |
| `drive_files_download` | drive | true | `gws drive files get` (media) |
| `drive_permissions_create` | drive | false | `gws drive permissions create` |
| `docs_documents_get` | docs | true | `gws docs documents get` |
| `docs_documents_create` | docs | false | `gws docs documents create` |
| `sheets_spreadsheets_create` | sheets | false | `gws sheets spreadsheets create` |
| `chat_spaces_list` | chat | true | `gws chat spaces list` |
| `meet_spaces_create` | meet | false | `gws meet spaces create` |
| `forms_forms_create` | forms | false | `gws forms forms create` |
| `forms_responses_list` | forms | true | `gws forms responses list` |
| `admin_reports_activities_list` | admin-reports | true | `gws admin-reports activities list` |
| `admin_reports_usage_get` | admin-reports | true | `gws admin-reports usageReports get` |

**Passthrough (1):** `gws_execute(service, resource, method, params?, json?, upload?)` invokes any `gws` Discovery method. Service is explicit; bundle eligibility resolves the same way. **Readonly classification:** the caller declares `readonly: true|false` per call; under Read-Only mode, `readonly: false` calls are rejected.

**Management tools (5):**

| Tool | Purpose |
|---|---|
| `list_accounts` | Lists granted accounts with per-account bundles and Read-Only state |
| `set_default_account(email)` | Changes the default account used when tool calls omit `account` |
| `remove_account(email, confirm?)` | Confirmation-guarded; server-revoke + local-delete for one account |
| `factory_reset(confirm?)` | Confirmation-guarded; revokes + deletes all accounts and state |
| `set_read_only(enabled, account?, confirm?)` | Toggles Read-Only per account; toggle-off requires re-consent confirmation |

**Total:** 22 + 12 + 1 + 5 = **40 MCP tools**.

### Manifest (`manifest.json`) highlights

- `server.type`: `binary` (pending feasibility spike confirmation)
- `server.entry_point`: `server/authtools-mcp`
- Per-platform binary paths: `bin/darwin-arm64/authtools-mcp` + `bin/darwin-arm64/gws` (and x64 equivalents)
- `user_config`: `{}` in v1 (zero-config install)
- `name`, `version`, `description`, `icon.png` populated for the directory
- LICENSE + NOTICE files for `gws` (Apache-2.0) bundled in the archive

### Cross-surface parity mechanism

`gws` stores credentials in a canonical location (`~/.config/gws/` + OS keyring entry). The MCP server invokes the same `gws` binary (bundled inside `.mcpb`) and leaves `GOOGLE_WORKSPACE_CLI_CONFIG_DIR` at default — so tokens created by either surface are visible to the other.

**Known risk (pending feasibility spike):** macOS keychain ACLs bind to the *writing binary's* code signature. A Homebrew-installed `gws` writes entries ACL'd to that binary; the bundled `gws` inside `.mcpb` is a different binary with a different signature. First cross-read may trigger an "Always Allow" prompt. Spike will confirm whether this is tractable via widened ACLs or requires an alternative mechanism (shared-keychain-item attributes, group ACL, etc.).

### Concurrency policy

- **Concurrent OAuth flows:** MCP detects an in-progress `gws auth login` via `~/.config/gws/auth.pid` (or equivalent); if another flow is active, surfaces *"Auth already in progress — complete it in the open browser tab"* instead of starting a second flow.
- **Parallel MCP tool calls needing token refresh:** trust `gws`'s own credentials-file write atomicity. No additional in-process mutex in v1. Revisit if races surface in the field.
- **`state.json` writes:** single-writer (Concierge MCP server); atomic via tmp+rename.

## Edge Cases

| Scenario | Behavior |
|---|---|
| Token expired, refresh succeeds | Silent; tool call proceeds |
| Token expired, refresh fails | Auto-trigger consent flow; progress surfaced via `notifications/progress` |
| Tool invoked, service in no granted bundle | Auto-trigger consent for the service's primary bundle; progress surfaced |
| Tool invoked, service in a granted bundle | Proceed; no consent prompt |
| Account revoked server-side (admin action) | Detected on first failing call; treated as "bundle not granted" → consent flow |
| User ran `gws auth logout` in terminal mid-session | Next MCP call sees missing token → treated as "bundle not granted" → consent flow |
| Keychain locked | OS surfaces native unlock prompt; MCP does not retry-loop |
| Consent denied by user | Tool returns `error_code: "consent_denied"` within 2s; no retry |
| `gws` binary missing/corrupt | MCP startup fails with actionable error; reinstall is the recovery |
| Network failure during `gws` call | Propagate `gws` exit code 1 as MCP tool error with vendor stderr + `gws --version` attached |
| `gws_execute` unknown service | Propagate `gws` exit code 3 (validation error) as `error_code: "validation_error"` |
| Read-Only mode on, write tool called | Return `error_code: "read_only_active"` with a pointer to `set_read_only(enabled: false, confirm: ...)` |
| Read-Only toggled during in-flight write | In-flight call completes; mode applies to subsequent calls |
| `gws_execute` with `readonly: false` while Read-Only on | Same as write tool — reject with `read_only_active` |
| Concurrent OAuth (CLI + Desktop) | Second caller detects pidfile, surfaces "Auth already in progress" message |
| Two `.mcpb`-installed accounts with same email | `gws` uses email as primary key; second add replaces first |
| Arch mismatch on install | Claude Desktop selects the correct per-arch binary via manifest; mismatch would fail install |
| `gws` version drift (system gws vs bundled) | v1 uses bundled exclusively; PATH-`gws` toggle deferred to v1.1 |
| `gws` CLI breaking change between releases | Concierge CI pins a specific `gws` version; major vendor upgrades require Concierge re-release |
| Security CVE in bundled `gws` | 48h SLA: Concierge releases a patched `.mcpb`; users auto-update via Claude Desktop extension update |
| Extension upgrade with existing state.json | Migrator runs on schema mismatch; tokens lazily re-validated on next call |
| Uninstall (Claude Desktop) | Extension files removed; state.json and keychain entries preserved; reinstall restores |
| `factory_reset` invoked | Revokes all accounts (best-effort); deletes state.json; keychain cleaned |
| Confirmation token reuse attempt | Second call with same token fails; requires fresh first-call + new token |
| Confirmation token expired (>60s) | Second call fails; requires fresh first-call |
| Cross-binary keychain ACL mismatch | Feasibility spike TBD; if confirmed, first cross-read prompts "Always Allow" — documented as first-run behavior |

## Acceptance Criteria

### Install & first run
1. Double-click `Concierge.mcpb` → Claude Desktop installs → extension appears in extension list.
2. First tool call in Productivity bundle (for a user who has previously completed `gws auth setup`) opens a single browser window, user consents, tool call succeeds — no additional terminal interaction required.

### Tool coverage
3. All 22 vendor helper commands are exposed as named MCP tools (Calendar vendor helpers intentionally omitted per claude.ai-Calendar complementarity; see Approach §).
4. All 12 Concierge shim tools are exposed: `drive_files_list`, `drive_files_download`, `drive_permissions_create`, `docs_documents_get`, `docs_documents_create`, `sheets_spreadsheets_create`, `chat_spaces_list`, `meet_spaces_create`, `forms_forms_create`, `forms_responses_list`, `admin_reports_activities_list`, `admin_reports_usage_get`.
5. `gws_execute` passthrough can invoke any `gws` Discovery method.
6. 5 management tools are exposed: `list_accounts`, `set_default_account`, `remove_account`, `factory_reset`, `set_read_only`.

### Bundles & consent
7. 6 bundles (Productivity, Collaboration, Admin & Compliance, Education, Creator, Automation) defined in code with scope mappings matching Data & State §.
8. Invoking a tool whose service is in no granted bundle auto-triggers consent for that service's primary bundle; browser shows only that bundle's scopes. If any containing bundle is already granted, the tool proceeds without prompting.
9. `set_read_only(true)` causes `readonly: false` tools to return `error_code: "read_only_active"`; tool list remains unchanged.
10. `set_read_only(false, confirm: ...)` triggers re-consent flow for writable scopes before clearing the flag.

### Multi-account
11. `list_accounts` returns all granted accounts with per-account bundles and Read-Only state.
12. Every tool accepts optional `account` parameter; omitting uses `default_account`.
13. `set_default_account` switches the default.

### Destructive operations (confirmation-guarded)
14. `remove_account(email)` without `confirm` returns a confirmation token + warning; does not delete anything.
15. `remove_account(email, confirm: <valid-token>)` calls `oauth2.revoke` (best-effort) and deletes keychain entries. After success, `security find-generic-password -s "com.google.gws.*" -a "<email>"` finds no matching entries; `gws auth export` for that email fails.
16. `factory_reset(confirm: <valid-token>)` removes all accounts and deletes `state.json`.
17. Expired or reused confirmation tokens return a fresh confirmation-required response.

### Cross-surface parity
18. **Procedure:** (i) run `gws auth login` in terminal for a test account; (ii) record `credentials.json` file hash; (iii) invoke any tool in Productivity bundle via Claude Desktop; (iv) assert: no browser prompt opens, tool call succeeds, `credentials.json` hash unchanged. (v) Reverse: authenticate via MCP first, then run `gws drive files list` in terminal; assert no prompt, success.

### Credential hygiene
19. `security find-generic-password` confirms keychain entries are ACL'd to the `gws` binary path (whether bundled or Homebrew), use `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, and are namespaced under `gws`'s canonical prefix. **Concierge never writes keychain entries directly.**
20. Grep over (a) MCP server stdout/stderr across a full integration test session, (b) `~/Library/Logs/Claude/` entries for the extension, (c) `gws` logs (if `GOOGLE_WORKSPACE_CLI_LOG` is set), (d) any file Concierge writes — for patterns `ya29.*`, `1//*`, base64-JWT shape, `client_secret.*` — matches zero.

### Performance (from constitution)
21. **P1:** Initial OAuth grant completes within 3s after user consent on a healthy network.
22. **P2:** Keychain read (time from tool invocation to token available to `gws` subprocess) < 50ms.
23. **P3:** MCP wrapper overhead (end-to-end tool latency minus `gws` subprocess latency) < 100ms.

### Failure modes
24. **F1:** Consent denied → tool returns `error_code: "consent_denied"` within 2s of denial.
25. **F2:** Expired token + refresh fails → auto-consent triggers; total time from failed call to retry success < 10s on healthy network.
26. **F3:** Account revoked server-side → first failing call detects and returns `error_code: "account_revoked"` with confirmation-pattern re-auth offer.
27. **F4:** `gws_execute` with unknown service → returns `error_code: "validation_error"` matching `gws` exit code 3.

### Scope hygiene
28. **S1:** Each of the 6 bundles is audited before release. No bundle exceeds 24 scopes (1-scope headroom below Google's 25-scope testing-mode cap).

### Distribution
29. CI produces `Concierge-<version>-darwin-arm64.mcpb` and `Concierge-<version>-darwin-x64.mcpb` on tag.
30. CI verifies `gws` LICENSE + NOTICE files are present in the archive.
31. Security-patch SLA: a CVE in bundled `gws` or its dependencies triggers a patched re-release within 48h.

### Testing discipline
- Integration tests against a dedicated sandbox Google Workspace account (plus a second sandbox tenant for multi-account tests)
- TDD for all 12 shim tools (request/response shape frozen before implementation)
- Manual verification checklist in Claude Desktop for every release

## Open Questions

Resolved items from /review applied inline. The following are implementation details intentionally deferred to `/plan`:

- Language choice for the MCP server binary (Node/TypeScript vs Rust vs Go — `gws` is Rust; staying in-language has packaging advantages, but Node is the documented `.mcpb` path)
- Exact CI pipeline (GitHub Actions + `gws` binary fetch from their releases, or build-from-source)
- Extension data-directory resolution across Claude Desktop versions (manifest-specified vs inferred)
- `state.json` schema version format and migrator harness
- Confirmation-token generation details (entropy, format)
- Log verbosity controls and log-file location (off by default; surface via `user_config` later — backlog)
- Feasibility spike outcomes: desk-research results in `docs/specs/google-workspace-mcp/spikes.md`. No architectural blockers found. Two hands-on tests (browser-launch + loopback binding; cross-binary keychain ACL) remain for Justin's machine (~30 min total).
- **sha256-pinned bundled `gws` binary:** plan should define how CI fetches upstream release tarballs, verifies checksums, and pins versions. Replaces "bundled authoritative" with a tighter integrity mechanism.
