// @concierge/core — entry point.
//
// This package holds foundation modules shared by vendor packages under
// @concierge/*. Submodules are re-exported from named subpaths (see the
// package.json "exports" map): errors, log, state, confirmation, tools, mcp,
// vendor-cli. This barrel exists so `import '@concierge/core'` is valid but
// encourages callers to import the named subpath they actually need.
//
// Subpath extraction happens incrementally (see docs/VERSIONING.md and the
// monorepo migration plan). Initially this file is a placeholder so typecheck
// and lint pass while the code still physically lives in
// @concierge/google-workspace. As modules move in, they become re-exported
// here for diagnostic tooling.

export {};
