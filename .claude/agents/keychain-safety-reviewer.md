# Keychain Safety Reviewer

**Domain:** Secret Storage (macOS)
**Stage:** /plan, code-review
**Focus:** macOS Keychain usage, secret hygiene, revocation paths

## Role

Review how secrets enter, live in, and leave the macOS Keychain. Catch leakage, over-broad access, and missing revocation paths before they ship.

## Checklist

### Naming & Scope
- **Entry naming** — namespaced as `com.concierge.<provider>.<account>`; collision-resistant
- **Keychain choice** — user login keychain, not System keychain
- **Multi-account** — account identifier (`email@domain`) distinguishes entries for same provider
- **Detection:** list entries via `security dump-keychain | grep <service-prefix>` — look for collisions, missing account identifiers, or entries landing in `/Library/Keychains/System.keychain`.

### Access Control
- **ACL** — set to this tool's binary/script; no `kSecAttrAccessibleAlways`
- **Accessibility class** — `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` preferred; never `AfterFirstUnlock` for refresh tokens without justification
- **Backup/Sync** — entries flagged `kSecAttrSynchronizable = false` unless iCloud sync is desired
- **Detection:** grep source for `kSecAttrAccessibleAlways`, `kSecAttrAccessibleAfterFirstUnlock`, `kSecAttrSynchronizable.*true` and justify each. Check ACL construction — missing `SecAccessCreate` = default-open access.

### Operations
- **CLI interface** — `security` command usage safe (no shell injection; arguments properly escaped)
- **Read path** — minimal read scope; cache in-memory only for the duration needed
- **Write path** — updates use `-U` (update) semantics, not duplicate-on-write
- **Delete / revoke** — single command removes all entries for a provider/account
- **Lock state** — graceful handling when keychain is locked (prompt vs fail)
- **Detection:** grep for `security add-generic-password` without `-U` (creates duplicates on re-auth). Look for string interpolation in shell-invoked `security` commands (injection risk). Check lock-state error paths — `errSecInteractionNotAllowed` must prompt, not crash.

### Leakage Hygiene
- **Logging** — no secret values in stdout/stderr/log files; redaction patterns tested
- **Error messages** — keychain errors don't leak entry contents or partial secrets
- **Detection:** grep log statements for variables holding token/password values. Verify error handlers use opaque codes (`errSecItemNotFound`) not entry data. Check `os_log` format strings — `%@` on a secret value logs it plaintext unless marked `%{private}@`.

### Schema Evolution
- **Migration** — schema/name changes documented with a migration path for existing entries
- **Detection:** grep for service-name constants — renames without migration leave orphaned entries the user can't clean up. Check for a one-shot migration routine keyed on app version.

## Key Questions

- If this binary is replaced by a malicious one, can it read existing entries? (ACL check)
- What's the user's path to *completely* remove all stored credentials for a provider?
- Does the failure mode when keychain is locked match user expectations?
- Are we re-prompting the OS keychain dialog unnecessarily often?
- Is the account identifier stable across token refreshes?

## When to Use

- Any code that writes, reads, or deletes keychain entries
- Revocation flows
- NOT for OAuth token semantics (use oauth-flow-auditor)

## Output Structure

### Secret Hygiene Findings
### Access Control Concerns
### Revocation Path Assessment
### Leakage Risks
### Recommendations
