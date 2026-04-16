# Security Policy

Concierge handles OAuth tokens, OS keychain data, and Developer-ID code signing. We take security reports seriously.

## Reporting a Vulnerability

**Do NOT open a public issue for security vulnerabilities.**

Report privately through one of:

1. **GitHub private vulnerability reporting** (preferred):
   [https://github.com/Jstottlemyer/Concierge/security/advisories/new](https://github.com/Jstottlemyer/Concierge/security/advisories/new)

2. **Email:** security reports can go to `justin.h.stottlemyer@gmail.com` with the subject line `[Concierge Security]`. Keep the description high-level in email; offer to share full details over an encrypted channel on request.

When reporting, please include:
- Affected component (`@concierge/google-workspace`, `@concierge/core`, the signed `.mcpb` artifact, the CI signing pipeline, or docs)
- Affected version (check `concierge_info` in Claude Desktop, or the `.mcpb` filename)
- A clear reproducer, minimized to the smallest failing case you can produce
- Your assessment of impact (confidentiality / integrity / availability)
- Whether the vulnerability is public knowledge elsewhere

## Supported Versions

Only the latest minor release receives security patches. v0.x releases are pre-1.0 and may not all receive backports — stay current.

| Version | Supported |
|---|---|
| Latest `v0.x` | ✅ |
| Earlier `v0.x` | ❌ (upgrade) |

## Response Expectations

This is a solo-maintained project. Expect:

- Acknowledgement within **72 hours**
- Initial triage + severity assessment within **7 days**
- Fix timeline depending on severity and scope — critical issues prioritized

If the vulnerability is in an upstream dependency (e.g., `googleworkspace/cli`, `@modelcontextprotocol/sdk`), we'll coordinate with the upstream maintainers and credit you in both places when appropriate.

## Scope

In scope for this policy:
- Signed `.mcpb` artifacts produced by the `package-mcpb.yml` CI workflow
- `@concierge/core` and `@concierge/google-workspace` source code
- The `scripts/setup.sh` one-shot installer
- OAuth / token-handling behavior, including keychain interaction and log redaction
- Documentation that would lead a user to misconfigure security (OAuth scopes, Cloud Console steps, etc.)

Out of scope:
- Vulnerabilities in `googleworkspace/cli` itself (upstream `googleworkspace/cli` on GitHub)
- Vulnerabilities in Claude Desktop (report to Anthropic)
- Vulnerabilities in `node`, `pnpm`, `gcloud`, or other external tools our scripts invoke
- Issues requiring physical access to a user's unlocked Mac

## Credit

Reporters who follow this policy are credited in the release notes of the fix (unless they prefer anonymity). For novel or high-severity findings, a public advisory is published at [GitHub Security Advisories](https://github.com/Jstottlemyer/Concierge/security/advisories) once a fix is released.
