# @concierge/core

Foundation library for every `@concierge/*` vendor package. Private workspace package; not published to npm.

Holds the cross-vendor pieces:

- Canonical `ConciergeError` class + the full `ErrorCode` union, the `makeError()` envelope builder, and `USER_FACING_MESSAGES`.
- (Future extraction) generic `state.json` loader + migrator, structured log redactor, confirmation-phrase framework, tool registry, MCP schema/dispatch/server, generic CLI subprocess runner.

Vendor packages (e.g. `@concierge/google-workspace`) import from named subpath exports — `@concierge/core/errors`, `@concierge/core/log`, etc. On `.mcpb` publish the vendor's tsup bundle inlines all of core, so nothing from `@concierge/core` is a separate runtime dep in the shipped extension.

See [VERSIONING.md](../../VERSIONING.md) for the per-package semver policy.

## Commands

```bash
pnpm --filter @concierge/core typecheck
pnpm --filter @concierge/core test
pnpm --filter @concierge/core lint
```

## License

MIT.
