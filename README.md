# Concierge

**Concierge** is a monorepo of Claude Desktop Extensions that brings service integrations into Claude, strictly local — data never leaves your Mac.

## Repository layout

Concierge is a `pnpm` workspace of independently-versioned packages:

```
packages/
├── core/                    @concierge/core (private)
│                            Foundation library — errors, state, tool
│                            registry, MCP plumbing, generic CLI runner.
│                            Shared by every vendor package.
│
└── google-workspace/        @concierge/google-workspace
                             First vendor package. The .mcpb you install.
                             Wraps googleworkspace/cli to expose Gmail,
                             Drive, Docs, Sheets, Forms, Tasks, Chat, Meet,
                             Keep, Classroom, Admin Reports, Apps Script,
                             and more — 42 typed MCP tools.
```

Future vendor packages (e.g. `@concierge/github`, `@concierge/notion`) live alongside `google-workspace/` under `packages/`. Each ships as its own `.mcpb` and is versioned independently — see [VERSIONING.md](VERSIONING.md).

## Google Workspace vendor package

The user-facing extension today. See [`packages/google-workspace/README.md`](packages/google-workspace/README.md).

### Complementary to claude.ai's hosted Google connectors

Claude Desktop already includes hosted connectors for Gmail, Calendar, and Drive. Those are **read / search / analyze** focused. Concierge is **action / write / create** focused and covers 10 services the hosted connectors don't. You can run both at once; see [`docs/setup/user-onboarding.md`](docs/setup/user-onboarding.md) for guidance on which to use when.

### Install

Two install guides, same install — pick whichever matches how you like to work:

- **Quickstart** (terminal recipe, commands only, ~10 min): [docs/setup/quickstart.md](docs/setup/quickstart.md)
- **Full onboarding** (prose + troubleshooting, ~15 min): [docs/setup/user-onboarding.md](docs/setup/user-onboarding.md)

At a glance:

1. Complete the one-time Google Cloud setup (OAuth client + enable APIs + `gws auth login`).
2. Obtain `Concierge-GoogleWorkspace-<version>-darwin-<arch>.mcpb` — from the Releases page, built locally (`packages/google-workspace/build/pack.sh`), or directly from Justin for v1 early users (repo is currently private).
3. Open the `.mcpb` with Claude Desktop.
4. Use it: ask Claude to send an email, upload a file, create a form, etc.
5. Run `concierge_info` at any time to confirm which build (version + `build_time`) you have installed.

## Status

- `@concierge/core`: `0.1.0` — first extracted core.
- `@concierge/google-workspace`: `0.1.0` — monorepo vendor-package cut.

Target platform: **macOS only** (v1). Linux/Windows deferred.

## Documentation

- [Versioning policy](VERSIONING.md)
- [Constitution](docs/constitution.md) — umbrella principles for every package
- [Google Workspace vendor docs](docs/vendors/google-workspace/) — spec, plan, review, check, spikes
- [User onboarding (one-time setup)](docs/setup/user-onboarding.md)
- [Injection regression check](docs/setup/injection-regression-check.md)
- [Troubleshooting](docs/troubleshooting.md) — common errors + recovery
- [Manual verification checklist](docs/release/manual-verification-checklist.md)
- [Release procedure](docs/release/release-procedure.md)

## Development

Requires Node 20+ and pnpm 10+.

```bash
pnpm install
pnpm -r typecheck
pnpm -r test
pnpm -r lint
pnpm --filter @concierge/google-workspace build
packages/google-workspace/build/pack.sh           # produces Concierge-GoogleWorkspace-<version>-darwin-<arch>.mcpb
packages/google-workspace/build/verify-pack.sh    # verifies the produced .mcpb
```

## License

MIT. Bundled `gws` binary is Apache-2.0 (see `LICENSE.gws` inside each Google-Workspace `.mcpb` archive).
