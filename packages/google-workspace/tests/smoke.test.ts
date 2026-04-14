import { describe, it, expect } from 'vitest';

import { bootstrap } from '../src/index.js';

describe('concierge-mcp smoke', () => {
  it('imports the entry module without throwing', () => {
    expect(() => bootstrap()).not.toThrow();
  });

  it('reports the expected package identity and loads the MCP SDK', () => {
    const info = bootstrap();
    expect(info.name).toBe('@concierge/google-workspace');
    // In dev (ts-node / vitest) tsup `define` hasn't fired, so bootstrap
    // reports the dev-fallback sentinel. Bundled builds substitute in the
    // real vendor version.
    expect(info.version).toBe('0.0.0-dev');
    expect(info.sdkLoaded).toBe(true);
  });
});
