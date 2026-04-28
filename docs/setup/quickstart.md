---
title: Quickstart
description: One-command setup for terminal users
---

# Concierge — Quickstart

For terminal users who want the condensed recipe. Full prose + troubleshooting:
[user-onboarding.md](./user-onboarding.md).

## Prereqs

- macOS (Apple Silicon or Intel)
- Google account
- Claude Desktop installed ([claude.ai/download](https://claude.ai/download))
- ~5-10 minutes (most of that is OAuth click time)

**Node is NOT required** — Claude Desktop bundles its own Node runtime for MCP extensions.

## Install

One command. That's it.

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Jstottlemyer/Concierge/main/scripts/setup.sh)
```

The script bootstraps a tiny downloader, fetches the signed `@concierge/setup` binary
for your architecture, verifies its sha256 + cosign signature, and execs it. From there
the binary takes over: it scans your machine, asks for consent, installs anything
missing (Homebrew, `gws`, gcloud), provisions your Google Cloud project + OAuth
client, walks you through `gws auth login`, enables the Workspace APIs, and registers
the `.mcpb` into Claude Desktop. Re-run anytime; it skips work already done.

### Pin to a specific version

Defaults to the latest release. To pin:

```bash
VERSION=2.0.0 bash <(curl -fsSL https://raw.githubusercontent.com/Jstottlemyer/Concierge/main/scripts/setup.sh)
```

### Verification

Want to inspect the bootstrap script before piping it into bash? Download it
separately, check its sha256 against the published hash, then run:

```bash
curl -fsSL -o /tmp/setup.sh https://raw.githubusercontent.com/Jstottlemyer/Concierge/main/scripts/setup.sh
shasum -a 256 /tmp/setup.sh
# Compare against the SHA published at:
#   https://jstottlemyer.github.io/Concierge/setup.sh.sha256
bash /tmp/setup.sh
```

The setup binary itself is verified inside the script with both sha256 and a
[Sigstore cosign](https://docs.sigstore.dev/) signature. If you want to pin every
artifact yourself (sha256 + cosign + manual extract), see the
[advanced `gh release download` path](./user-onboarding.md#manual-fallback) in
the onboarding doc.

## What you'll see

1. Banner + "About to install" consent prompt.
2. Probe scan: which prerequisites are already present, which are missing.
3. Per-step install progress with timestamps.
4. Browser opens for Google OAuth — pick your account, approve scopes.
5. Final success screen with `concierge_info` + `list_accounts` test prompts to try
   in Claude Desktop.

## Troubleshooting

If anything fails mid-flow, the binary prints a recovery hint inline. For the full
error map, see [troubleshooting.md](../troubleshooting.md). For the underlying
manual steps (useful if you want to understand or recover from a partial bootstrap),
see [user-onboarding.md → Manual fallback](./user-onboarding.md#manual-fallback).
