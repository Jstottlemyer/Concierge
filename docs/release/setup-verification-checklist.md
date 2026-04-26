# Setup Verification Checklist — Concierge Setup-Hardening v2

Run before signing off any minor-or-greater release of `@concierge/setup`. Three persona machines + two migration smoke tests. Justin signs off each persona; release blocked until all three pass.

Pair with the per-release `manual-verification-checklist.md` (the `.mcpb` itself) — this checklist verifies the orchestrator that installs it.

## Persona 1 — Fresh macOS + personal Gmail

### Pre-conditions

- [ ] macOS Sonoma 14+, Apple Silicon, freshly imaged or wiped test profile
- [ ] Homebrew not installed (`command -v brew` returns nothing)
- [ ] Node not installed (`command -v node` returns nothing)
- [ ] gws / gcloud / Claude CLI / Claude Desktop not installed
- [ ] `~/.config/gws/` does not exist
- [ ] `~/.config/concierge/` does not exist
- [ ] `~/.claude.json` does not exist (or has no `mcpServers.concierge` key)
- [ ] No `~/Library/Application Support/Claude/Claude Extensions/local.mcpb.*concierge*` dir
- [ ] Personal Gmail account (`@gmail.com`) staged for sign-in
- [ ] Stopwatch ready

### Steps

- [ ] Paste the curl one-liner from `docs/index.md`; press Enter; start stopwatch
- [ ] Bash bootstrap shows: Homebrew install, Node install, tarball download, SHA-256 verify line, cosign verify line
- [ ] Orchestrator banner: `Concierge Setup v<version>`
- [ ] Consent screen lists: Detected (none) / Will install (gws, gcloud, Claude CLI, Claude Desktop) / no prior-Concierge lines; press Y
- [ ] Account-type prompt appears: answer `p` (personal)
- [ ] Install phase: per-tool `→ Installing …` then `✓ … installed` lines for brew, node (skipped if just installed), gws, gcloud, claude, Claude Desktop
- [ ] OAuth phase: `gws auth setup` prompts for Project ID with suggested `concierge-<lastname>-<random4>`; accept default
- [ ] API enablement: per-service progress lines for the productivity bundle
- [ ] `gws auth login`: browser opens; sign in to personal Gmail; grant scopes; terminal heartbeat dots until callback
- [ ] Claude install + register: pre-emptive stale-extension check (no-op on fresh), `open -a Claude <.mcpb>`, `claude mcp add` for CLI
- [ ] Verification phase: per-target check lines (Desktop ✓, CLI ✓)
- [ ] Success screen prints `build_id` + per-target status; stop stopwatch

### Per-phase pass criteria

- [ ] Bash bootstrap: tarball SHA matches `.sha256` manifest; cosign verify against Rekor returns 0
- [ ] After install: `command -v gws gcloud claude brew node` all resolve
- [ ] After OAuth: `gws auth status` returns `token_valid: true` with the personal Gmail address
- [ ] After register: `~/.claude.json` contains `mcpServers.concierge` with absolute path to extracted `dist/index.js`
- [ ] After verify: `concierge_info` in Claude Desktop returns matching `build_id`; `node <unpacked>/dist/index.js` spawn-server reports `tools=42`
- [ ] No errors in `~/.config/concierge/setup-logs/setup-<timestamp>.log`

### Final pass criterion

- [ ] Concierge installed and verified within **15 minutes** of script start (excluding browser-click time on Google consent)

### Signoff

Signed off by: ____________  Date: ____________  Build: ____________

---

## Persona 2 — Fresh macOS + Workspace non-admin

### Pre-conditions

- [ ] macOS Sonoma 14+, Apple Silicon, fresh state per Persona 1's pre-conditions
- [ ] Google Workspace account where the tester is **NOT** the Super Admin (e.g., a member account on a corporate Workspace)
- [ ] Confirm via `admin.google.com` that the test account lacks admin console access

### Steps

- [ ] Paste curl one-liner; start stopwatch
- [ ] Bootstrap + banner as Persona 1
- [ ] Consent screen; press Y
- [ ] Account-type prompt: answer `w` (Workspace)
- [ ] Workspace admin self-identification prompt: answer `n` (not admin)
- [ ] Orchestrator generates `~/Desktop/concierge-admin-instructions-<timestamp>.txt`
- [ ] Orchestrator prints the "Forward this file to your IT admin; re-run setup once they've completed it." message
- [ ] Orchestrator exits 0; stop stopwatch
- [ ] Inspect generated `.txt` file: contains the user's Project ID, account email, scope justification, exact admin click-paths

### Per-phase pass criteria

- [ ] Generated doc matches the content of `docs/setup/workspace-admin-instructions.md` with project ID + email substituted
- [ ] Orchestrator does NOT proceed to OAuth, API enable, or Claude install phases
- [ ] Exit code is 0 (clean exit, not a failure)
- [ ] No partial Claude extension installed; no `mcpServers.concierge` key written to `~/.claude.json`
- [ ] Setup log present in `~/.config/concierge/setup-logs/`; no error lines

### Final pass criterion

- [ ] Static doc generated and orchestrator exited cleanly within **5 minutes** of script start

### Signoff

Signed off by: ____________  Date: ____________  Build: ____________

---

## Persona 3 — Fresh macOS + Workspace Super Admin

### Pre-conditions

- [ ] macOS Sonoma 14+, Apple Silicon, fresh state per Persona 1's pre-conditions
- [ ] Google Workspace account where the tester **IS** the Super Admin
- [ ] Org Cloud ToS NOT yet accepted (or use a Workspace where this is true) so the inline gate has work to do
- [ ] App Access Controls for the soon-to-be-created OAuth client NOT yet configured

### Steps

- [ ] Paste curl one-liner; start stopwatch
- [ ] Bootstrap + banner; consent screen; press Y
- [ ] Account-type prompt: answer `w`
- [ ] Workspace admin self-identification prompt: answer `y` (admin)
- [ ] `gws auth setup` Project ID prompt; accept suggested name
- [ ] **Inline admin gate 1 — Org Cloud ToS:** orchestrator prints the URL; tester opens it, accepts ToS in browser, presses Enter at "Done? [Enter]"
- [ ] **Inline admin gate 2 — App Access Controls:** orchestrator prints the URL + click-path; tester configures access for the OAuth client, presses Enter at "Done? [Enter]"
- [ ] API enablement phase
- [ ] `gws auth login`: browser opens; sign in with admin account; grant scopes
- [ ] Claude install + register; verification
- [ ] Success screen; stop stopwatch

### Per-phase pass criteria

- [ ] Each admin gate pauses for explicit Enter; no silent skip
- [ ] After OAuth: `gws auth status` returns `token_valid: true` with the admin account email; domain is the Workspace domain (not `gmail.com`)
- [ ] After verify: Desktop ✓ AND CLI ✓; `concierge_info` returns matching `build_id` in Claude Desktop
- [ ] Setup log shows admin-gate confirmations as discrete log entries

### Final pass criterion

- [ ] Concierge installed and verified within **15 minutes** of script start (excluding browser-click time on consent + admin-console pages)

### Signoff

Signed off by: ____________  Date: ____________  Build: ____________

---

## Migration smoke — v0.1.0 → current

### Pre-conditions

- [ ] Test machine with v0.1.0 `.mcpb` installed at `~/Library/Application Support/Claude/Claude Extensions/local.mcpb.justin-stottlemyer.concierge-google-workspace/`
- [ ] Existing `~/.config/gws/client_secret.json` + valid `gws auth status`
- [ ] Claude Desktop installed and previously launched against v0.1.0

### Steps

- [ ] Paste curl one-liner; start stopwatch
- [ ] Confirm consent screen surfaces: `Concierge extension v0.1.0 (will replace with v<new>)` + `gws ✓` + `gcloud ✓` + `Claude Desktop ✓` (all install phases skipped)
- [ ] Press Y; orchestrator skips install + OAuth; goes straight to verification
- [ ] Verification fails on sha256 mismatch → triggers hard-reinstall recovery (single attempt)
- [ ] Hard-reinstall sequence runs: `osascript quit Claude` → `rm -rf` unpacked dir → `open -a Claude` → `open -a Claude <.mcpb>` → CLI re-register
- [ ] Re-verification passes; success screen with NEW `build_id`

### Pass criteria

- [ ] Migration matrix line surfaced exactly as documented in `spec.md` Data section
- [ ] Hard-reinstall fires exactly once (no second attempt)
- [ ] Final `concierge_info` `build_id` matches the new release, NOT v0.1.0's
- [ ] Existing OAuth credentials preserved (no re-auth required)
- [ ] Re-run completes within **3 minutes** (warm re-run target)

### Signoff

Signed off by: ____________  Date: ____________  Build: ____________

---

## Migration smoke — v0.2.0 → current

### Pre-conditions

- [ ] Test machine with v0.2.0 `.mcpb` installed (signed + notarized build)
- [ ] Existing `~/.config/gws/client_secret.json` + valid `gws auth status`
- [ ] Claude Desktop installed and previously launched against v0.2.0

### Steps

- [ ] Paste curl one-liner; start stopwatch
- [ ] Consent screen surfaces: `Concierge extension v0.2.0 (will replace with v<new>)` + everything else ✓
- [ ] Press Y; verification → hard-reinstall → re-verify → success
- [ ] Stop stopwatch

### Pass criteria

- [ ] Same observables as v0.1.0 smoke, with the migration line correctly identifying v0.2.0 as the prior version
- [ ] Hard-reinstall fires exactly once
- [ ] Final `build_id` matches the new release
- [ ] Re-run completes within **3 minutes**

### Signoff

Signed off by: ____________  Date: ____________  Build: ____________

---

## Known acceptable warnings

- **Cosign install line on first run** — bootstrap will `brew install cosign` if absent. First-run only; subsequent runs skip.
- **Update-check transparency line** in consent screen — "Concierge checks GitHub for security updates once per day. No other data is sent." Expected, not a failure.
- **`↻ Homebrew already installed (4.x.y)`** style skip lines — expected on warm re-runs.
- **Heartbeat dots during OAuth wait** — expected; user-driven completion.
- **`Multiple gws installations found (will use brew-managed)`** — surfaces only on machines that previously had a non-brew gws on PATH; not a failure.

## What to do if a step fails

1. **Capture the bundle:** `concierge-setup --diagnose --bundle` — produces `~/Desktop/concierge-diagnose-<timestamp>.tar.gz` (redacted by default).
2. **Read the verbose log:** `~/.config/concierge/setup-logs/setup-<timestamp>.log` — token-shaped strings already redacted.
3. **File a setup-failure issue** using the GitHub issue template at `https://github.com/Jstottlemyer/AuthTools/issues/new?template=setup-failure.md`; attach the bundle.
4. **For privacy-sensitive escalation** (filesystem usernames, project numbers needed): re-run with `concierge-setup --diagnose --full` and share the bundle privately rather than on the public issue.
5. **Do NOT mark the persona signed off** until the underlying issue is fixed and the persona run is repeated end-to-end on a freshly-imaged machine.
