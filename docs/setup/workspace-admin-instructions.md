---
title: Workspace Admin Approval
description: Template request for Google Workspace Super Admins to approve Concierge for one user
---

# Concierge — Request for Admin Approval

> **This is a template, not a request itself.** If you're a Concierge user on a Google Workspace domain, copy the message body below into an email or doc and replace every `<INSERT_…>` placeholder with your real values (your email, your domain, the OAuth client ID `setup.sh` printed for you). Then send it to your Workspace Super Admin.
>
> Coming back here as the admin? Skip past this notice and start at section 1 — the rest of the page is written to you.

---

**To:** Google Workspace Super Admin for `<INSERT_DOMAIN_HERE>`
**From:** `<INSERT_USER_EMAIL>`
**Re:** Approving Concierge (third-party OAuth app) for one user account

I am `<INSERT_USER_EMAIL>` and I would like to use Concierge — an open-source desktop tool that lets Claude Desktop (Anthropic's AI assistant app) perform actions in my Google Workspace account on my behalf. Examples: drafting Gmail replies, creating Docs, updating Sheets. Because our domain restricts third-party OAuth apps, the OAuth consent will fail until you approve Concierge in the Workspace admin console. This document is everything you need to make that decision and complete the two-click approval. Estimated time: 5–10 minutes.

---

## 1. What Concierge requests (OAuth scopes)

Concierge uses the upstream `googleworkspace/cli` (`gws`) as its API surface. It will request the following scopes against **only my account** — not the domain, not other users:

| Scope (plain English) | What it lets Concierge do | What it does NOT do |
|---|---|---|
| Gmail (modify) | Read, draft, send, label, archive my mail | Cannot read other users' mail; cannot change account settings |
| Drive | Read/create/edit files I own or are shared with me | Cannot access files outside my visibility; cannot share externally without my action |
| Docs / Sheets / Slides | Read and edit document/spreadsheet/presentation content | Cannot bypass per-doc permissions |
| Calendar | Read and create events on my calendars | Cannot modify other users' calendars |
| Forms | Read my forms and their responses | Cannot publish to others' forms |
| Tasks | Read and edit my task lists | None beyond Tasks scope |
| Chat (messages, spaces) | Send/read messages in spaces I'm in | Cannot join spaces I'm not invited to |
| Meet (created spaces) | Create meeting spaces I own | Cannot join arbitrary meetings |
| People (contacts) | Read and edit my contacts | Cannot read directory beyond shared visibility |
| Apps Script (projects) | Manage script projects I own | Cannot deploy domain-wide scripts |

**No admin scopes. No `admin.directory.*`. No domain-wide delegation.** Every scope is per-user, gated by Google's normal OAuth consent screen, and revocable at any time at `myaccount.google.com/permissions`.

## 2. Signing and provenance

The Concierge `.mcpb` binary I will install is:

- **Apple Developer ID signed.** Team ID `P5FDYS88B7` (Justin Hayes Stottlemyer). Signature verifiable via `codesign --verify --deep --strict`.
- **Apple notarized.** Apple's notary service has scanned the binary and confirmed it contains no known malware. Verifiable via `spctl --assess`.
- **SLSA build-provenance attested.** GitHub Actions publishes a signed attestation proving the released binary was built from the public source at the tagged commit — verifiable with `gh attestation verify`.

Recipe: `https://github.com/Jstottlemyer/Concierge#verifying-a-release`. In short: Apple has independently verified Concierge is not malware, and the binary you would be approving was provably built from the public GitHub source you can audit.

## 3. What you need to do in admin.google.com

### Step 1 — Accept the Cloud Terms of Service for the org (one-time, if not already done)

1. Sign in to `https://console.cloud.google.com/` as a Super Admin.
2. If prompted to accept the Google Cloud Terms of Service for the organization, click **Accept**.

[Screenshot: cloud-tos-acceptance.png — to be added before v2.0 ships]

### Step 2 — Trust the Concierge OAuth client in App Access Control

1. Open `https://admin.google.com/`.
2. Navigate: **Security → Access and data control → API controls → App access control**.
3. Click **Manage Third-Party App Access → Add app → OAuth App Name Or Client ID**.
4. Paste this Client ID exactly:
   ```
   <INSERT_CLIENT_ID_HERE>
   ```
5. Click **Search**, select the result, click **Select**.
6. Choose scope: **Limited to specific users** → select `<INSERT_USER_EMAIL>` (or an OU containing only that user).
7. Set access: **Trusted: Can access all Google services**.
8. Click **Configure** → **Confirm**.

[Screenshot: app-access-control-add-app.png — to be added before v2.0 ships]
[Screenshot: app-access-control-trusted.png — to be added before v2.0 ships]

That's it. I'll be notified the next time I re-run setup; no further action required from you.

## 4. Vendor profile

- **Project:** Concierge
- **License:** MIT (open source)
- **Maintainer:** Justin Stottlemyer (single maintainer)
- **Source:** `https://github.com/Jstottlemyer/Concierge`
- **Security policy:** `https://github.com/Jstottlemyer/Concierge/blob/main/SECURITY.md`
- **Releases (signed binaries + SLSA attestations):** `https://github.com/Jstottlemyer/Concierge/releases`
- **Affiliation:** None. Concierge is not affiliated with Anthropic, Google, or any other vendor.

## 5. Threat model summary

- **Data Concierge sees:** only my own Workspace data, scoped to the OAuth grants in §1.
- **Where data goes:** between my Mac and Google's APIs, plus the local Claude Desktop process. **No Concierge-operated server. No telemetry. Nothing transits Anthropic infrastructure as part of Concierge's operation** (Claude Desktop's own model traffic is Anthropic's own ToS, separate from Concierge).
- **What Concierge cannot do under these scopes:** no admin actions, no other users' data, no directory enumeration, no domain-wide changes. The scope set is the bound — Google enforces this server-side, not Concierge.
- **Cloud project ownership:** the OAuth client lives in my own Google Cloud project (`<INSERT_PROJECT_ID>`). I am the project owner. Revocation = deleting the OAuth client in my project, or removing the app from your App Access Control allowlist.

## 6. Questions

If anything here is unclear or you'd like to see source code, configuration, or the signed-build verification before approving, please reply to me directly (`<INSERT_USER_EMAIL>`) or open an issue at `https://github.com/Jstottlemyer/Concierge/issues`. Concierge is not affiliated with Anthropic, Google, or any vendor; I am the sole responsible party for this request.
