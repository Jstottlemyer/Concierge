# Concierge Constitution

**Version:** 1.0
**Created:** 2026-04-13
**Last Amended:** 2026-04-13

## Mission

Build authentication tooling that lets both Claude CLI (Claude Code) and Claude Desktop safely use third-party services. Start by wrapping existing vendor CLIs (first: `googleworkspace/cli`) as Claude Code skills, then bridge to Claude Desktop via local MCP servers. OAuth + macOS Keychain are the default credential path.

## Core Principles

### I. Dual-Surface Parity
Every auth integration must work for both **Claude CLI** (as a skill/plugin) and **Claude Desktop** (as an MCP server or plugin). Design once, wrap twice. If a capability can't be exposed to both surfaces, that's a design flaw, not an acceptable limitation.

### II. Credential Safety by Default
OAuth is the preferred auth method. Secrets live in **macOS Keychain**, never in plaintext files, env vars, or the repo. Tokens refresh automatically. User consent is explicit and scoped. Revoking access must be a single command.

### III. Wrap, Don't Rewrite
Prefer wrapping existing, well-maintained CLI tools (e.g., `googleworkspace/cli`, `gh`, `gcloud`) over reimplementing vendor APIs. The vendor owns correctness; we own the auth surface, the UX, and the Claude integration.

### IV. Pattern over One-Offs
The first integration (Google Workspace) establishes a repeatable pattern: auth flow → keychain storage → CLI wrapper → skill spec → MCP bridge. Each subsequent third-party integration follows the same shape, with any deltas justified.

### V. Least Privilege, Visible Scope
OAuth scopes are minimum-necessary and surfaced to the user at grant time. No silent scope upgrades. Scope changes require re-consent.

## Quality Standards

### Testing
- Integration tests for auth flows (OAuth round-trip, token refresh, keychain read/write)
- Unit tests for wrapper logic and error handling
- Manual verification checklist for Claude CLI and Claude Desktop surfaces per integration
- TDD for wrapper logic; auth flows tested against real providers in a sandbox account

### Security
- No secrets in logs, errors, or telemetry
- Keychain entries namespaced (`com.concierge.<provider>.<account>`)
- Short-lived tokens preferred; refresh tokens encrypted at rest
- Threat model documented per integration (token theft, scope creep, replay)

### Performance
- Auth operations (initial grant, refresh) < 3s on a healthy network
- Cached tokens return instantly (< 50ms keychain read)
- CLI wrapper overhead < 100ms above the underlying tool

## Agent Roster

Default pipeline agents (28 — review/6, plan/6, check/5, code-review/9, judge, synthesis) are always active.

### Project-Specific Agents
- **oauth-flow-auditor** — OAuth 2.0 / OIDC spec compliance (PKCE, redirect URIs, scope, token lifecycle) — `/review`, `/plan`, code-review
- **keychain-safety-reviewer** — macOS Keychain usage, secret hygiene, revocation paths — `/plan`, code-review
- **skill-plugin-specialist** — Claude Code skill/plugin structure, invocation triggers, distribution — `/plan`, code-review
- **mcp-protocol-expert** — MCP server spec compliance for Claude Desktop — `/plan`, code-review
- **cli-wrapper-ergonomics** — wrapping vendor CLIs (install detection, arg pass-through, version drift) — `/plan`, code-review

Defined in `.claude/agents/`.

## Constraints

### In Scope
- Auth skills/plugins for Claude CLI (Claude Code)
- MCP servers or local plugins for Claude Desktop
- OAuth 2.0 / OIDC flows
- macOS Keychain integration
- Wrappers around vendor CLIs
- First target: `googleworkspace/cli`

### Out of Scope
See **Backlog** for items that may promote to scope later.

- Running a hosted auth service
- Windows/Linux keychain support (v1 is macOS-only)
- Reimplementing vendor SDKs
- API-key-only providers with no OAuth path (unless explicitly added later)
- Multi-user / team credential sharing

### Technical Constraints
- **Platform:** macOS (Darwin) first; cross-platform later
- **Languages:** Shell/Python for CLI skills; Node/TypeScript or Python for MCP servers
- **Secrets:** macOS Keychain via `security` CLI or native API
- **Distribution:** Claude Code plugins + MCP server packages
- **Dependencies:** vendor CLIs installed via user's package manager (Homebrew)

## Backlog (Potential Future Scope)

Items currently out of scope that may promote into scope in a future version:

- **Hosted auth service** — if multi-device sync becomes a requirement
- **Windows/Linux keychain support** — `libsecret` (Linux), Windows Credential Manager; promote when users on those platforms surface
- **Native vendor SDK integrations** — where wrapping a CLI is infeasible (no CLI exists, or CLI significantly lags the SDK)
- **API-key-only providers** — providers without OAuth (e.g., some dev tools); would need a distinct secret-handling pattern
- **Multi-user / team credential sharing** — shared keychain, delegated access, team OAuth apps
- **Threat-modeler persona** — add as a project-specific agent if default security personas prove too generic

## Governance

- Constitution supersedes informal preferences for this project
- Amendments require updating this file and incrementing the version
- All specs created under this constitution reference its version
- Backlog items promote to In Scope via constitution amendment
