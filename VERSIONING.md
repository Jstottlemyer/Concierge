# Concierge Versioning

Concierge ships two artifacts that users install: the `@concierge/setup`
orchestrator (curl-pulled bootstrap) and per-vendor `.mcpb` bundles
(currently `@concierge/google-workspace`). Releases are driven by tag pushes,
and **the tag prefix selects which artifacts get built**.

## Tag schemes

| Tag pattern | Triggers | Builds | When to use |
|---|---|---|---|
| `release-v*.*.*` | [`release.yml`](.github/workflows/release.yml) | `setup` tarball **+** `.mcpb` (atomic upload) | Coordinated release. Default choice. |
| `google-workspace-v*.*.*` | [`package-mcpb.yml`](.github/workflows/package-mcpb.yml) | `.mcpb` only | Vendor-only fix between coordinated releases. |

Both patterns accept pre-release suffixes — `release-v2.0.0-rc1`,
`google-workspace-v0.3.1-rc2` — fire the same workflows and produce draft
GitHub releases.

> **Legacy:** bare `vX.Y.Z` tags were removed 2026-04-15 because they bypassed
> the signing gate (which matches `google-workspace-v*` only). Do not
> re-introduce them. See [`package-mcpb.yml`](.github/workflows/package-mcpb.yml)
> header.

## When to push which tag

```
Did the user-facing bootstrap flow OR setup binary change?
├── YES → push `release-v*` (coordinated; bumps both artifacts together)
└── NO, only the .mcpb changed (vendor bug fix, new tool, etc.)
    └── push `google-workspace-v*` (ships only the bundle)
```

If in doubt, prefer `release-v*`. Coordinated releases are always safe;
the per-vendor escape is a maintenance optimization.

## Semver rules

### `release-v*` (coordinated)

Bump when **either** the setup orchestrator **or** any bundled `.mcpb` makes a
user-facing change.

- **Major** — bootstrap flow changes user-visibly (new prompt, new required
  arg, removed capability, breaking state-schema migration).
- **Minor** — capabilities expand (new vendor bundled, new auto-detected
  environment, new opt-in feature).
- **Patch** — bug fixes; no behavior change for already-working setups.

### `google-workspace-v*` (per-package)

Standard semver on the `@concierge/google-workspace` API surface (its tools,
their input/output schemas, the `concierge_info` response shape).

- **Major** — breaking tool contract or removed tool.
- **Minor** — new tools, new bundles, new opt-in capabilities.
- **Patch** — bug fixes, dependency bumps, internal refactors.

Other vendor packages (`@concierge/github`, `@concierge/notion`, …) will
follow the same `<vendor>-v*.*.*` convention when they ship.

## Worked timeline

| Date | Tag | What ships | Why |
|---|---|---|---|
| Day 0 | `release-v2.0.0` | New setup bootstrap **+** bundled `google-workspace` v0.3.0 | Coordinated v2.0 launch. |
| Day 21 | `google-workspace-v0.3.1` | `.mcpb` only | Gmail draft-creation bug fix. Setup binary unchanged; users re-run the curl one-liner (or `concierge-setup --update` once v2.1 lands) to pick up the new bundle. |
| Day 35 | `release-v2.0.1` | New setup binary **+** bundled `google-workspace` v0.3.1 | Orchestrator gains an "ASCII auto-detect" tweak. Coordinated patch re-bundles the latest vendor `.mcpb`. |

Note in the Day 35 step: `release-v2.0.1` re-publishes the same `.mcpb`
bytes already shipped as `google-workspace-v0.3.1`, but signed and uploaded
atomically alongside the new setup tarball so curl-installs get a consistent
pair.

## Per-package independent semver (vendors)

Each package under `packages/*` is versioned independently in its
`package.json`:

- `@concierge/core` — private workspace package; not published. Bundled into
  vendor `dist/` by tsup at package time.
- `@concierge/setup` — orchestrator; version tracks `release-v*` tags.
- `@concierge/google-workspace` — first vendor; version tracks
  `google-workspace-v*` tags.

## How users tell what's installed

Call the `concierge_info` tool. Returns vendor package name + version,
`@concierge/core` version, bundled `gws` version, MCP SDK version, Node
runtime version, manifest schema version, and a `build_time` / `build_id`
baked at package time (see CLAUDE.md "Stale `.mcpb` install detection").

## Dependency flow

`@concierge/google-workspace` depends on `@concierge/core` via
`"workspace:*"` during development. On `.mcpb` publish, tsup bundles core
into the vendor's `dist/` — no `@concierge/core` dep at runtime.
