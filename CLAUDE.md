# Concierge — Repo-level Instructions for Claude

Rules specific to this codebase. Apply in addition to user-level `~/CLAUDE.md`.

## Architecture

- **Monorepo** (pnpm workspaces). Packages live in `packages/*`.
- `@concierge/core` is a private workspace package — shared primitives used by every vendor package.
- `@concierge/google-workspace` is the first vendor package; produces the `.mcpb` users install.
- Future vendor packages (`@concierge/github`, etc.) will follow the same shape.
- **Concierge has NO shared/hosted Google Cloud project.** Each end user owns their own Cloud project in v1. A "verified Concierge app" is a v2 commercial-path consideration, deferred until commercial distribution is warranted.

## Known error patterns (diagnose these correctly — do NOT hallucinate infra explanations)

### "Project 'projects/<name>' not found or deleted"

- **Meaning:** the `project_id` field in the user's `~/.config/gws/client_secret.json` does not match a real Google Cloud Project ID.
- **NOT meaning:** a shared Concierge GCP project is down. There is no shared project. This error is always local-config.
- **Common cause:** `project_id` is a human-readable label that was set to a placeholder (e.g., `authtools-spike`) during Cloud Console setup instead of the real Project ID string (looks like `my-project-abc-123456`).
- **Fix:** ask the user to open `https://console.cloud.google.com/home/dashboard?project=<PROJECT_NUMBER>` (project number = the numeric prefix of the OAuth client_id before the hyphen). Read the "Project ID" field from Project Info. Update `~/.config/gws/client_secret.json.installed.project_id` to match. No OAuth re-auth needed.
- **Never tell the user "Anthropic must restore access"** — there is no Anthropic-hosted Concierge project.

### "API has not been used in project" / "SERVICE_DISABLED"

- **Meaning:** the Google API for the service (gmail / drive / docs / etc.) is not enabled on the user's Cloud project.
- **Fix:** direct them to `docs/setup/user-onboarding.md` Step 4.5, or run `packages/google-workspace/build/enable-apis.sh` if `gcloud` is installed.
- Concierge' `toolErrorFromGwsResult` detects this and returns `error_code: "api_not_enabled"` with a direct enable URL in `docs_url`.

### "Error 403: access_denied" during OAuth consent

- **Meaning:** user's Google account is not on the OAuth consent screen's Test users list (app is in Testing mode).
- **Fix:** `docs/setup/user-onboarding.md` Step B.3 — add self as Test user in Cloud Console.

### "Error 400: invalid_scope" during gws auth login

- **Meaning:** `gws auth login --scopes drive,gmail` was used. `--scopes` expects full URLs; service short-names go with `--services`.
- **Fix:** use `gws auth login --services drive,gmail`.

## When adding a new vendor

1. `mkdir packages/<vendor>` alongside existing packages.
2. Copy `packages/google-workspace/{package.json,tsconfig.json,tsup.config.ts,build/}` as a template; edit for the new vendor.
3. Create `docs/vendors/<vendor>/` and run `/kickoff` → `/spec` → `/review` → `/plan` → `/check` → `/build` targeting that dir.
4. Shared primitives (errors, state, log redaction, tool registry, MCP server, CLI runner) belong in `@concierge/core`. Vendor-specific tools, bundles, auth flow, and scope definitions belong in the vendor package.
5. Each vendor ships its own independently-versioned `.mcpb`. `VERSIONING.md` at repo root is the semver policy.

## Testing discipline

- All tests (500+ cases across ~67 suites) must stay green. New work adds tests; existing tests never get deleted without a spec-level justification.
- `pnpm -r typecheck && pnpm -r test && pnpm -r lint` is the green-bar before any commit.
- Integration tests gated behind `CONCIERGE_INTEGRATION=1` (needs real gws + authenticated account).
- Perf benchmarks gated behind `CONCIERGE_PERF=1`.

## Packaging

- `.mcpb` is self-contained: tsup bundles all runtime deps (including `@concierge/core`) into `dist/index.js`. No `node_modules/` vendoring needed anymore.
- Per-vendor packaging: `packages/<vendor>/build/pack.sh` produces `Concierge-<Vendor>-<version>-<arch>.mcpb`.
- CI workflows (`.github/workflows/package-mcpb.yml`) are per-arch; pinned gws checksum per vendor in `packages/<vendor>/build/gws-checksums.txt`.
- **CI signs + notarizes automatically on `google-workspace-v*.*.*` tag push** (darwin-arm64; x64 stays unsigned workflow-artifact only). Local `CONCIERGE_SIGN=1 ./build/pack.sh` remains the fallback for notary-degraded days or pre-tag dry runs.

## Signing prerequisites (macOS)

- `brew install coreutils` is required before running `CONCIERGE_SIGN=1 ./build/pack.sh`. The signer caps the notary wait at 1800s via `gtimeout`; without it the fallback branch warns and has no upper bound on the wait.
- macOS ships bash 3.2. Avoid `"${empty_array[@]}"` under `set -u` — it errors as "unbound variable". Branch on `${#arr[@]}` or use the `${arr[@]+"${arr[@]}"}` idiom instead.
- **Bash EXIT traps can silently poison the script's exit code under `set -e`.** If the trap's final executed command returns non-zero, that rc propagates as the script's exit — even after `SUCCESS` was printed. Specifically: `[[ -n "$VAR" ]] && cmd` where VAR is empty returns 1, short-circuits `cmd`, trap returns 1. Use an `if` block + explicit `return 0` in EXIT traps. Bit us during v0.2.0-rc1 signing (fix: commit `10eaf27`).

## Target persona

v1 primary user: startup CEO (PashionFootwear). Gmail + Sheets + Forms are the high-frequency triad. Admin bundle is genuinely wanted but mocked-only in v1 (drift detector guards against fixture divergence).

## MCP protocol gotchas (bugs bitten in v0.1.0)

- `structuredContent` MUST match the tool's declared `outputSchema`. If you wrap tool data in `{ok, data}` for the envelope, put the **unwrapped** data in `structuredContent` and keep the wrapper only in `content[].text`. Strict clients (Claude Desktop) show "Tool execution failed" despite server-side success when this mismatches.
- On error paths, **omit `structuredContent` entirely** — outputSchema describes the success shape only. Rely on `isError: true` + text-content envelope instead.
- tsup bundling flattens `dist/` to a single file. Relative-path lookups from `import.meta.url` that worked in `src/` may be off by one level in `dist/`. Use multi-candidate resolution (try both `../bin/...` and `../../bin/...`).

## Known gws CLI surface quirks (v0.22.5)

- `gws auth list` / `gws auth export --all` / `gws auth export <email> --scopes-only` **do not exist**. Use `gws auth status` which returns single-user JSON: `{ user, scopes, token_valid, encrypted_credentials_exists, project_id, ... }`.
- gws is **effectively single-account** in v0.22.5. Our multi-account design is aspirational — light it up when upstream supports it.
- Real command paths differ from intuition: `forms responses list` is actually `forms forms responses list` (4 segments). `admin-reports usageReports get` is `admin-reports userUsageReport get`.
- `project_id` in `~/.config/gws/client_secret.json` must match the real Cloud Project ID **string** (e.g. `desktop-app-493302`), not the numeric project number prefix of the client_id, and definitely not a placeholder. Symptom when wrong: `"Project 'projects/<x>' not found or deleted"` — not an Anthropic infra issue.

## Stale `.mcpb` install detection + recovery

- Claude Desktop doesn't always replace a `.mcpb` when you reopen the file. The old unpacked extension can remain at `~/Library/Application Support/Claude/Claude Extensions/local.mcpb.<author>.<name>/`.
- Symptom: tools that use strict output schemas (like `concierge_info`, `list_accounts`) return "Tool execution failed" while permissive-schema tools (like `gmail_triage`) keep working. Every install-level bug fix also looks latent because the fix is in the new build but Claude Desktop is running the old one.
- Fast diagnostic: `concierge_info` returns `build_time` + `build_id` baked at build time via tsup define. If those don't match what your latest `./build/pack.sh` printed, Claude Desktop is running a stale copy.
- Fallback diagnostic: `shasum -a 256 <unpacked-extension>/dist/index.js` vs `shasum -a 256 packages/google-workspace/dist/index.js`. Mismatch ⇒ stale install.
- Hard-reinstall sequence (when `open -a Claude <.mcpb>` doesn't take):
  ```bash
  osascript -e 'quit app "Claude"'
  rm -rf "$HOME/Library/Application Support/Claude/Claude Extensions/local.mcpb.justin-stottlemyer.concierge-google-workspace"
  open -a Claude
  open -a Claude /path/to/Concierge-GoogleWorkspace-<version>-darwin-arm64.mcpb
  ```

## Docs are dual-format

- Every end-user setup flow ships in two docs: a prose version (`docs/setup/user-onboarding.md`) with context + troubleshooting, and a terminal recipe (`docs/setup/quickstart.md`) with minimal prose. Keep both in sync when changing setup steps.
