---
title: Concierge — Google Workspace for Claude Desktop
description: Gives Claude Desktop write capabilities to Google web services — Gmail, Drive, Docs, Sheets, Slides, Forms, Calendar, Tasks, Chat, Meet, People, and Apps Script.
---

**Gives Claude Desktop write capabilities to Google web services.**

Concierge is a [Claude Desktop](https://claude.ai/download) extension that lets Claude **send emails, create and edit Google Docs / Sheets / Slides / Forms, upload to Drive, manage tasks, start Chat / Meet conversations**, and more — 42 typed tools across 12 Google Workspace services.

Claude Desktop's built-in Google connectors focus on **reading and searching**. Concierge fills the gap: **writing and creating**. Runs entirely on your Mac; your OAuth credentials never leave your machine.

<p align="center" style="margin: 2em 0;">
  <a href="https://github.com/Jstottlemyer/Concierge/releases/latest" style="display:inline-block; padding: 0.75em 1.5em; background: #0366d6; color: white; text-decoration: none; border-radius: 6px; font-weight: 600;">↓ Download for macOS</a>
  &nbsp;&nbsp;
  <a href="#install">One-line install</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/Jstottlemyer/Concierge">Source on GitHub</a>
</p>

<!--
  HERO ASSET — drop a screenshot or 30-second GIF of Claude Desktop completing
  one of the example prompts below directly here. Recommended: 1200×600 PNG, or
  animated GIF/MP4. Save under docs/assets/ and reference as:
      ![Concierge in action](assets/hero.png)
  Until then, the page reads as text-only — adding the hero asset is the single
  highest-leverage visual change.
-->

---

## Built-in connectors vs Concierge

| | Anthropic's hosted connectors | Concierge |
|---|---|---|
| **Focus** | Read · Search · Analyze | Write · Create · Send |
| **Data path** | Routed through Anthropic | Your Mac ↔ Google directly |
| **OAuth client** | Anthropic-owned | Yours, in your own GCP project |
| **Services** | Gmail · Calendar · Drive | + Docs · Sheets · Slides · Forms · Tasks · Chat · Meet · People · Apps Script |
| **Install** | Built in | One-click `.mcpb` |

---

## Why trust this

| 🍎 Signed by Apple | 🛡 Notarized by Apple | 🔒 Stays on your Mac |
|---|---|---|
| Developer ID Application certificate — verified publisher identity | Apple-scanned for malware — Gatekeeper opens it cleanly, no warnings | Your Google login lives in macOS Keychain. Anthropic never sees your mail or files. |

Every release is also published with [SLSA build-provenance attestations](https://github.com/Jstottlemyer/Concierge/releases/latest) — you can independently verify the binary came from this source code. [Verification recipe →](https://github.com/Jstottlemyer/Concierge#verify-your-download)

---

## Install

One command on a fresh macOS:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Jstottlemyer/Concierge/main/scripts/setup.sh)
```

`setup.sh` walks you through Homebrew, the `gws` CLI, gcloud, your Google Cloud project + OAuth client, API enablement, and Claude Desktop install — skipping any step already done. Safe to re-run.

**Pin to a specific version** (defaults to the latest release if `VERSION` is unset):

```bash
VERSION=2.0.0 bash <(curl -fsSL https://raw.githubusercontent.com/Jstottlemyer/Concierge/main/scripts/setup.sh)
```

Want to inspect the script before piping to bash? See the [Quickstart's verification path](setup/quickstart.md#verification) — download `setup.sh` separately, sha256-check it against the published hash, then run it.

> **Why is it safe to run this command?** The script's source is [public on GitHub](https://github.com/Jstottlemyer/Concierge/blob/main/scripts/setup.sh) and the `.mcpb` it installs is signed and notarized by Apple. The setup binary the script downloads is verified inline with both sha256 and a Sigstore cosign signature. Read the script before you run it if you'd like.

Prefer manual? See [Quickstart](setup/quickstart.md) or [Full onboarding](setup/user-onboarding.md).

---

## What you get

Ask Claude things like:

> Send a draft email to marketing@ with this week's revenue numbers from the "Q2 Pipeline" sheet.

> Create a new Google Slides deck titled "Board update — April" with sections for metrics, product, and hiring.

> Upload `~/Desktop/contract.pdf` to my "Legal / Contracts" Drive folder.

> Schedule a 30-min meeting with alice@company.com next Tuesday afternoon and add a Meet link.

> Create a Google Form for the post-event survey with these 5 questions: ...

All of it happens locally — Claude talks to the extension, the extension talks to Google's APIs with your OAuth token, nothing flows through a third-party cloud.

---

## Links

- **[Download the latest signed release](https://github.com/Jstottlemyer/Concierge/releases/latest)**
- **[Source on GitHub](https://github.com/Jstottlemyer/Concierge)**
- **[Troubleshooting](troubleshooting.md)** — common errors + recovery
- **[Security policy](https://github.com/Jstottlemyer/Concierge/security/policy)**

---

<p style="text-align:center; opacity:0.6; font-size:0.85em; margin-top:3em">
  macOS (Apple Silicon)
</p>
