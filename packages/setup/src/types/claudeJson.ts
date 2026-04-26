// Shape + state model for ~/.claude.json (Claude Code CLI MCP server registry).
// Tolerant of forward fields we don't know about.

export interface ClaudeJsonShape {
  mcpServers?: Record<
    string,
    {
      type?: 'stdio' | 'sse' | 'http';
      command?: string;
      args?: string[];
      scope?: 'user' | 'project' | 'local';
      env?: Record<string, string>;
    }
  >;
  [key: string]: unknown; // tolerate forward fields
}

export type ClaudeJsonState =
  | { kind: 'absent' } // file not found
  | { kind: 'no_concierge'; otherServers: readonly string[] } // file present, no concierge key
  | {
      kind: 'registered';
      expectedAbsPath: string;
      actualAbsPath: string;
      matches: boolean;
    }; // key present
