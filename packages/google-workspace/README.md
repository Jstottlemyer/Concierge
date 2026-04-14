# @concierge/google-workspace

The user-facing Concierge vendor package for Google Workspace. Ships as a Claude Desktop Extension (`.mcpb`) that wraps the open-source [googleworkspace/cli](https://github.com/googleworkspace/cli) (`gws`) to expose Gmail, Drive, Docs, Sheets, Slides, Forms, Tasks, Chat, Meet, Keep, Classroom, Admin Reports, Apps Script, and more — **42 typed MCP tools**. Your own Google Cloud project owns the OAuth credentials; Concierge never routes your data through a third party.

This is one vendor package inside the Concierge monorepo. See the [repo-root README](../../README.md) for the monorepo overview.

## Commands

```bash
pnpm --filter @concierge/google-workspace typecheck
pnpm --filter @concierge/google-workspace test
pnpm --filter @concierge/google-workspace lint
pnpm --filter @concierge/google-workspace build
packages/google-workspace/build/pack.sh           # produces Concierge-GoogleWorkspace-<version>-darwin-<arch>.mcpb
packages/google-workspace/build/verify-pack.sh    # verifies the produced .mcpb
```

## Runtime dependencies

Declared as workspace deps:

- `@concierge/core` — foundation library. Bundled into `dist/index.js` at build time; no separate runtime dep in the shipped `.mcpb`.
- `@modelcontextprotocol/sdk`, `zod`, `zod-to-json-schema` — bundled the same way.

## Which version do I have installed?

Call the `concierge_info` tool from Claude. It returns the vendor package version, the `@concierge/core` version that was bundled in, the bundled `gws` version + sha256, the Node runtime, and the manifest schema version. Handy for bug reports and release verification.

## License

MIT. The bundled `gws` binary is Apache-2.0 (see `LICENSE.gws` inside the `.mcpb`).
