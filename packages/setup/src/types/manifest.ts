// Embedded manifest baked into the concierge-setup binary at build time.
// Describes the bundled .mcpb tarball and its signing/build provenance.

export interface EmbeddedManifest {
  schemaVersion: 1;
  bundledMcpb: {
    filename: string;
    version: string;
    sha256: string; // 64 lowercase hex chars
    arch: 'darwin-arm64' | 'darwin-x64';
    namespace: string; // local.mcpb.<author>.<name>
    buildId: string;
    buildTime: string; // ISO-8601
    sourceCommit: string; // 40-char git sha
  };
  setupVersion: string;
}
