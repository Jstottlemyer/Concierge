# Concierge

[![CI](https://github.com/Jstottlemyer/Concierge/actions/workflows/ci.yml/badge.svg)](https://github.com/Jstottlemyer/Concierge/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)](https://www.apple.com/macos/)

> **Native Google Workspace inside Claude Desktop.** One-click install, Developer-ID signed, runs entirely on your Mac — your OAuth credentials never leave your machine.

Concierge is a Claude Desktop Extension (`.mcpb`) that wraps the open-source [`googleworkspace/cli`](https://github.com/googleworkspace/cli) to expose **42 typed MCP tools** across Gmail, Drive, Docs, Sheets, Slides, Forms, Calendar, Tasks, Chat, Meet, People, and Apps Script.

## Why Concierge?

Claude Desktop already ships hosted connectors for Gmail, Calendar, and Drive — those are **read/search/analyze** focused and route data through Anthropic. Concierge is the complement: **action/write/create** focused and **strictly local**. Your Google Cloud project owns the OAuth client; credentials live in your macOS Keychain; data flows only between your Mac and Google.

| | Hosted connectors (claude.ai) | Concierge (this repo) |
|---|---|---|
| Install | Built in | `.mcpb` download |
| Services | Gmail · Calendar · Drive | + 9 more (Docs, Sheets, Slides, Forms, Tasks, Chat, Meet, People, Apps Script) |
| OAuth client | Anthropic-owned | Your GCP project |
| Data path | Cloud-mediated | Your Mac only |
| Focus | Read / search | Write / create / act |

## Install

One command on a fresh macOS:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Jstottlemyer/Concierge/main/scripts/setup.sh)
```

`setup.sh` walks you through Homebrew, `gws`, gcloud, your Google Cloud project + OAuth client, API enablement, and Claude Desktop install — skipping any step already done. Idempotent; safe to re-run. Source at [`scripts/setup.sh`](./scripts/setup.sh).

Prefer manual? See:
- [**Quickstart**](docs/setup/quickstart.md) — terminal recipe, ~10 min
- [**Full onboarding**](docs/setup/user-onboarding.md) — prose + troubleshooting, ~15 min

## Verify your download

Every release on the [Releases page](https://github.com/Jstottlemyer/Concierge/releases) is Developer-ID signed and Apple-notarized. The release body contains a pre-filled verify block; the three-command recipe:

```bash
# 1. File integrity
shasum -a 256 Concierge-GoogleWorkspace-<version>-darwin-arm64.mcpb
# compare against the release body's SHA-256 line

# 2. Developer ID signature + notarization
unzip -p Concierge-GoogleWorkspace-<version>-darwin-arm64.mcpb bin/gws > /tmp/gws
codesign -dvv /tmp/gws 2>&1 | grep Authority
# expected: Authority=Developer ID Application: JUSTIN HAYES STOTTLEMYER (P5FDYS88B7)

# 3. SLSA build-provenance attestation
gh attestation verify Concierge-GoogleWorkspace-<version>-darwin-arm64.mcpb \
  --repo Jstottlemyer/Concierge
```

## Repository layout

```
packages/
├── core/                    @concierge/core (private)
│                            Foundation library — errors, state, tool
│                            registry, MCP plumbing, generic CLI runner.
│                            Shared by every vendor package.
│
└── google-workspace/        @concierge/google-workspace
                             First vendor package. The .mcpb you install.
```

Future vendor packages (e.g. `@concierge/github`, `@concierge/notion`) live alongside `google-workspace/` under `packages/`. Each ships as its own `.mcpb` and is versioned independently — see [VERSIONING.md](./VERSIONING.md).

## Platform support

**macOS only** for v1. Intel (`darwin-x64`) builds are deferred until there's a target user — Apple Silicon (`darwin-arm64`) is the supported architecture today. Linux and Windows are out of scope; MCP extensions run inside Claude Desktop which is macOS-first.

## Documentation

- **[Setup quickstart](docs/setup/quickstart.md)** — terminal recipe
- **[Full onboarding](docs/setup/user-onboarding.md)** — prose + troubleshooting + verification
- **[Troubleshooting](docs/troubleshooting.md)** — common errors + recovery
- **[Release procedure](docs/release/release-procedure.md)** — for maintainers
- **[Versioning policy](VERSIONING.md)**

## Security

Security reports: see [SECURITY.md](./SECURITY.md). Private reporting via [GitHub Security Advisories](https://github.com/Jstottlemyer/Concierge/security/advisories/new) or email.

## Development

Requires Node 20+ and pnpm 10+.

```bash
pnpm install
pnpm -r typecheck
pnpm -r test
pnpm -r lint
pnpm --filter @concierge/google-workspace build

# Produce a .mcpb locally (unsigned dev build):
packages/google-workspace/build/pack.sh

# Produce a signed + notarized .mcpb (requires Developer ID cert + coreutils):
CONCIERGE_SIGN=1 packages/google-workspace/build/pack.sh

# CI produces signed + notarized + SLSA-attested .mcpb on tag push.
```

## License

[MIT](./LICENSE). The bundled `gws` binary is Apache-2.0 (see `LICENSE.gws` inside each `.mcpb`).
