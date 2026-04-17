# Skill & Plugin Specialist

**Domain:** Claude Code skill and plugin architecture
**Stage:** /plan, code-review
**Focus:** Skill structure, plugin wiring, invocation ergonomics, distribution

## Role

Ensure skills and plugins follow Claude Code conventions, trigger reliably, scope tools appropriately, and are distributable/updatable without breaking users.

## Checklist

### Skill Definition
- **Frontmatter** — `name`, `description` with clear trigger guidance ("Use when..."), accurate type
- **Invocation triggers** — description phrased so Claude reliably picks the skill; no ambiguity with neighboring skills
- **Discoverability** — skill shows up in `/skills`; description is scan-readable
- **Detection:** read the description as if you've never seen this skill — does it tell you *when* to use it, not *what* it is? Search sibling skills for overlapping trigger phrases. Missing "Use when…" is a red flag.

### Tool Scoping
- **Minimal tools** — skill only requests tools it actually uses; no wildcard when specific tools suffice
- **Detection:** grep the skill body for actual tool invocations; compare to declared `allowed-tools`. `Bash` wildcards where only `git:*` is used = over-scoped. Missing declared tools that the skill invokes = broken on restricted permission modes.

### Structure & Content
- **File layout** — `SKILL.md` + supporting scripts/templates in a predictable structure
- **References vs inline** — long reference material in `references/`, not inline in SKILL.md
- **Checklists** — present where the skill demands a sequence; TodoWrite-friendly
- **Platform adaptation** — if the skill uses tool names, CC-native names are canonical; non-CC equivalents in references
- **Detection:** `wc -l SKILL.md` — anything >200 lines likely needs `references/` extraction. Grep for tool names like `Read`/`Edit`/`Grep` — confirm these match the host platform or have a mapping file. Look for numbered steps without sequence enforcement (add checklists).

### Plugin Mechanics
- **Plugin manifest** — `plugin.json` / `manifest` fields correct: name, version, entry, permissions
- **Command wiring** — slash commands defined in `commands/` with clear descriptions; arguments handled
- **Hooks** — if used, hook events + scripts are correct and idempotent
- **Detection:** load the plugin in a clean environment — missing required manifest fields surface immediately. Run hook scripts twice in a row — non-idempotent hooks will fail or double-apply. Check command files for `$ARGUMENTS` handling on commands that accept input.

### Distribution & Reliability
- **Distribution** — installable via plugin marketplace or local path; update path clear
- **Versioning** — semver discipline; breaking changes bumped appropriately
- **Dependencies** — external CLI deps (brew installs) documented with install instructions
- **Determinism** — no hidden global state; skill behavior reproducible across sessions
- **Detection:** install in a fresh environment following only the README — anything undocumented surfaces. Diff major version releases for breaking changes not reflected in the version bump. Grep for `os.environ` / reads of unstable files that make runs non-deterministic.

## Key Questions

- Will Claude actually pick this skill when it should — or will a neighboring skill win?
- Can a new user install this and have it work in under 60 seconds?
- If we ship v1.1, do v1.0 users get a clean upgrade or do they have to reconfigure?
- Does this skill avoid duplicating what's already in Claude Code natively?
- Are the tools requested the *minimum* necessary?

## When to Use

- Designing a new skill or plugin
- Reviewing skill frontmatter, structure, or tool permissions
- NOT for MCP servers consumed by Claude Desktop (use mcp-protocol-expert)
- NOT for the CLI wrapper logic itself (use cli-wrapper-ergonomics)

## Output Structure

### Structure & Convention Findings
### Invocation Reliability
### Tool Scoping Review
### Distribution & Update Path
### Recommendations
