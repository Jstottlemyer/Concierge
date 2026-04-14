# Concierge Versioning

## Per-package independent semver

Each package under `packages/*` is released independently with its own semver.

- `@concierge/core` — foundational library; private workspace package (not published to npm).
- `@concierge/google-workspace` — first vendor package. User-visible via `.mcpb`.
- Future vendors (`@concierge/github`, `@concierge/notion`, etc.) — each independently versioned.

## Versioning rules

- **Major (X.0.0)** — breaking changes to public API, state schema, or tool contracts that require user action on upgrade.
- **Minor (0.X.0)** — new tools, new bundles, new features; backwards-compatible.
- **Patch (0.0.X)** — bug fixes, internal refactors, dependency bumps.

## Initial versions

- `@concierge/core`: `0.1.0` — first extracted core, subject to change as 2nd vendor is built.
- `@concierge/google-workspace`: `0.1.0` — structural milestone from 0.0.1 monolith to monorepo vendor package.

## How users tell what's installed

Call the `concierge_info` tool. Returns:

- vendor package name + version
- `@concierge/core` version
- bundled gws version
- MCP SDK version (via bundled dependency)
- Node runtime version
- manifest schema version

## Dependency flow

`@concierge/google-workspace` depends on `@concierge/core` via `"workspace:*"` during development. On `.mcpb` publish, tsup bundles core into the vendor's `dist/` — no core dep at runtime.
