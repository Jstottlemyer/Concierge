---
title: Concierge — Google Workspace for Claude Desktop
description: Gives Claude Desktop write capabilities to Google web services — Gmail, Drive, Docs, Sheets, Slides, Forms, Calendar, Tasks, Chat, Meet, People, and Apps Script.
---

# Concierge

**Gives Claude Desktop write capabilities to Google web services.**

Concierge is a [Claude Desktop](https://claude.ai/download) extension that lets Claude **send emails, create and edit Google Docs / Sheets / Slides / Forms, upload to Drive, manage tasks, start Chat / Meet conversations**, and more — 42 typed tools across 12 Google Workspace services.

Claude Desktop's built-in Google connectors focus on **reading and searching**. Concierge fills the gap: **writing and creating**. Runs entirely on your Mac; your OAuth credentials never leave your machine.

---

## Install

One command on a fresh macOS:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Jstottlemyer/Concierge/main/scripts/setup.sh)
```

`setup.sh` walks you through Homebrew, the `gws` CLI, gcloud, your Google Cloud project + OAuth client, API enablement, and Claude Desktop install — skipping any step already done. Safe to re-run.

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

<p style="text-align:center; opacity:0.7; font-size:0.9em; margin-top:3em">
  macOS (Apple Silicon) · Developer-ID signed · Apple notarized · SLSA build-provenance attested
</p>
