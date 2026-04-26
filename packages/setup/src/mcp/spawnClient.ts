// B5: spawn-server verification client.
//
// Spawns the bundled `.mcpb`'s server (`node <unpacked>/dist/index.js`),
// performs the MCP handshake over stdio, calls `concierge_info`, and returns
// the structured result. Used by `phases/verify.ts` as the strong-form
// liveness check that the binary actually works — catches stale-install +
// broken-build modes the static sha256 check can't see.
//
// Spawn contract (locked by spike, recorded in spec §Spawn-server contract):
//   • argv: `node <distIndexJsAbsPath>` — no extra args
//   • cwd:  inherit (NOT explicitly set; spike showed it doesn't need one)
//   • env:  inherit `process.env` so the child resolves `gws` on PATH
//   • stdio: piped via `StdioClientTransport`
//   • no pre-existing files / lockfiles required
//
// Lifecycle: every code path (success or error) closes the client transport,
// which sends SIGTERM to the spawned child. Tests assert no orphan processes
// remain after the suite runs.
//
// Error taxonomy is intentionally narrow (5 kinds). Each maps to a specific
// remediation surface in the consent / failure UIs:
//   • spawn-failed      — node binary missing / dist file missing
//   • init-timeout      — server hung during MCP `initialize`
//   • tool-call-timeout — server initialized but `concierge_info` hung
//   • tool-call-error   — server returned an MCP error envelope (isError)
//   • protocol-error    — response shape didn't match `concierge_info` schema
//   • exit-nonzero      — child died before/during handshake (transport close)

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
// Subpath is served via the SDK package.json `exports["./*"]` wildcard;
// types resolve through `typesVersions` to `dist/esm/client/stdio.d.ts`.
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export interface ConciergeInfo {
  buildId: string;
  buildTime: string;
  [key: string]: unknown;
}

export interface SpawnError {
  kind:
    | 'spawn-failed'
    | 'init-timeout'
    | 'tool-call-timeout'
    | 'tool-call-error'
    | 'protocol-error'
    | 'exit-nonzero';
  message: string;
  // exactOptionalPropertyTypes: omit the field rather than set undefined.
  stderr?: string;
  exitCode?: number;
}

/** Build a SpawnError, omitting `stderr`/`exitCode` keys when empty. */
function makeErr(
  kind: SpawnError['kind'],
  message: string,
  stderr?: string,
  exitCode?: number,
): SpawnError {
  const err: SpawnError = { kind, message };
  if (stderr !== undefined && stderr !== '') err.stderr = stderr;
  if (exitCode !== undefined) err.exitCode = exitCode;
  return err;
}

export type SpawnResult =
  | { ok: true; data: ConciergeInfo }
  | { ok: false; error: SpawnError };

export interface SpawnClientOptions {
  distIndexJsAbsPath: string;
  initTimeoutMs?: number;
  toolCallTimeoutMs?: number;
  /** Optional override for `node` binary; defaults to process.execPath. */
  nodeBinary?: string;
}

const DEFAULT_INIT_TIMEOUT_MS = 3000;
const DEFAULT_TOOL_CALL_TIMEOUT_MS = 5000;

const SETUP_VERSION_FALLBACK = '0.0.0';
function getSetupVersion(): string {
  return typeof __CONCIERGE_SETUP_VERSION__ !== 'undefined'
    ? __CONCIERGE_SETUP_VERSION__
    : SETUP_VERSION_FALLBACK;
}

interface TimedRaceResult<T> {
  timedOut: boolean;
  value?: T;
  error?: Error;
}

/**
 * Race a promise against a timeout. Resolves with `{timedOut: true}` if the
 * timer fires first; otherwise with `{value}` or `{error}` from the promise.
 * The timer is always cleared (no leaked handles / lingering timeouts that
 * keep vitest's process alive past the test).
 */
async function raceWithTimeout<T>(
  p: Promise<T>,
  ms: number,
): Promise<TimedRaceResult<T>> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<TimedRaceResult<T>>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
  });
  const work = p.then(
    (value): TimedRaceResult<T> => ({ timedOut: false, value }),
    (error: unknown): TimedRaceResult<T> => ({
      timedOut: false,
      error: error instanceof Error ? error : new Error(String(error)),
    }),
  );
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Try-close the SDK client. Swallow errors — close-time failures should not
 * mask whatever already-classified error the caller is reporting.
 */
async function safeClose(client: Client): Promise<void> {
  try {
    await client.close();
  } catch {
    // intentional swallow
  }
}

export async function callConciergeInfo(
  options: SpawnClientOptions,
): Promise<SpawnResult> {
  const initTimeoutMs = options.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS;
  const toolCallTimeoutMs =
    options.toolCallTimeoutMs ?? DEFAULT_TOOL_CALL_TIMEOUT_MS;
  const nodeBinary = options.nodeBinary ?? process.execPath;

  // Capture stderr best-effort: pipe it so we can attach a listener BEFORE
  // start() (the SDK transport returns a PassThrough immediately for this
  // exact reason). On any error path, the captured tail is surfaced to the
  // caller via SpawnError.stderr.
  const transport = new StdioClientTransport({
    command: nodeBinary,
    args: [options.distIndexJsAbsPath],
    // Inherit env so the child can find `gws` on PATH. Cast: SDK's Record
    // type bans undefineds and our process.env may have them.
    env: Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    ),
    stderr: 'pipe',
  });

  let stderrBuf = '';
  const stderrStream = transport.stderr;
  if (stderrStream !== null) {
    stderrStream.on('data', (chunk: unknown) => {
      const s = Buffer.isBuffer(chunk)
        ? chunk.toString('utf8')
        : typeof chunk === 'string'
          ? chunk
          : '';
      // Cap capture to keep error payloads bounded.
      if (stderrBuf.length < 8192) {
        stderrBuf = (stderrBuf + s).slice(0, 8192);
      }
    });
  }

  // Track unexpected transport close (child crashed mid-handshake). The SDK
  // surfaces this via the `connect()` promise rejection in most cases, but
  // we also stash the signal so `spawn-failed` vs `exit-nonzero` can be
  // distinguished if needed.
  const client = new Client(
    { name: 'concierge-setup-verifier', version: getSetupVersion() },
    { capabilities: {} },
  );

  // Phase 1: connect (which performs the MCP `initialize` handshake).
  const initRes = await raceWithTimeout(
    client.connect(transport),
    initTimeoutMs,
  );
  if (initRes.timedOut) {
    await safeClose(client);
    return {
      ok: false,
      error: makeErr(
        'init-timeout',
        `MCP initialize did not complete within ${initTimeoutMs}ms`,
        stderrBuf,
      ),
    };
  }
  if (initRes.error !== undefined) {
    await safeClose(client);
    // Heuristic: "ENOENT" / "spawn ... ENOENT" → spawn-failed; everything
    // else during init → exit-nonzero (child died, transport closed early).
    const msg = initRes.error.message;
    const kind: SpawnError['kind'] = /ENOENT|spawn .* ENOENT|not found/i.test(
      msg,
    )
      ? 'spawn-failed'
      : 'exit-nonzero';
    return { ok: false, error: makeErr(kind, msg, stderrBuf) };
  }

  // Phase 2: tools/call concierge_info
  const callRes = await raceWithTimeout(
    client.callTool({ name: 'concierge_info', arguments: {} }),
    toolCallTimeoutMs,
  );
  if (callRes.timedOut) {
    await safeClose(client);
    return {
      ok: false,
      error: makeErr(
        'tool-call-timeout',
        `concierge_info did not return within ${toolCallTimeoutMs}ms`,
        stderrBuf,
      ),
    };
  }
  if (callRes.error !== undefined) {
    await safeClose(client);
    return {
      ok: false,
      error: makeErr('tool-call-error', callRes.error.message, stderrBuf),
    };
  }

  const raw = callRes.value;
  // raw is the CallToolResult union. Narrow to the `content[]` shape (the
  // current spec); the alternate `toolResult` shape is legacy.
  if (raw === undefined || typeof raw !== 'object' || raw === null) {
    await safeClose(client);
    return {
      ok: false,
      error: makeErr(
        'protocol-error',
        'callTool returned a non-object response',
        stderrBuf,
      ),
    };
  }

  // MCP server convention (CLAUDE.md): on error path, omit structuredContent
  // and rely on isError + text envelope. Detect that here.
  const isError = (raw as { isError?: unknown }).isError === true;
  if (isError) {
    const content = (raw as { content?: unknown }).content;
    let textTail = '';
    if (Array.isArray(content)) {
      for (const c of content) {
        if (
          c !== null &&
          typeof c === 'object' &&
          (c as { type?: unknown }).type === 'text' &&
          typeof (c as { text?: unknown }).text === 'string'
        ) {
          textTail += (c as { text: string }).text;
        }
      }
    }
    await safeClose(client);
    const msg =
      textTail !== ''
        ? `concierge_info returned isError: ${textTail.slice(0, 512)}`
        : 'concierge_info returned isError with no text content';
    return { ok: false, error: makeErr('tool-call-error', msg, stderrBuf) };
  }

  const structured = (raw as { structuredContent?: unknown }).structuredContent;
  if (
    structured === undefined ||
    structured === null ||
    typeof structured !== 'object'
  ) {
    await safeClose(client);
    return {
      ok: false,
      error: makeErr(
        'protocol-error',
        'concierge_info response missing structuredContent (expected unwrapped data shape)',
        stderrBuf,
      ),
    };
  }

  const buildIdRaw = (structured as { buildId?: unknown }).buildId;
  const buildTimeRaw = (structured as { buildTime?: unknown }).buildTime;
  if (typeof buildIdRaw !== 'string' || typeof buildTimeRaw !== 'string') {
    await safeClose(client);
    return {
      ok: false,
      error: makeErr(
        'protocol-error',
        'concierge_info structuredContent missing required string fields buildId / buildTime',
        stderrBuf,
      ),
    };
  }

  // Compose the result: include the canonical fields plus any extras the
  // server volunteered. Always close before returning.
  const data: ConciergeInfo = {
    ...(structured as Record<string, unknown>),
    buildId: buildIdRaw,
    buildTime: buildTimeRaw,
  };
  await safeClose(client);
  return { ok: true, data };
}
