// B2: Read + validate the embedded `manifest.json` baked into the
// concierge-setup binary at build time.
//
// The manifest is the trust root for the orchestrator: it records the bundled
// `.mcpb` filename, version, sha256, build provenance, and namespace. Every
// downstream verification step (verify.ts, recover.ts, claudeRegister.ts)
// reads from here rather than from constants — so corruption or drift here
// must be a hard failure, not a silent fallback.
//
// Validation is hand-rolled (no external schema lib) to keep the bundled
// `dist/index.js` small. Strict-TS clean — no `unknown`-as-`any` shortcuts;
// every field is narrowed via type guards before assignment.
//
// Fail-closed: any deviation from the schema throws a descriptive Error
// naming the offending field + expected shape. Callers should treat a thrown
// error as a fatal config-integrity failure (the binary itself was built
// wrong) and refuse to proceed.

import { readFile } from 'node:fs/promises';

import type { EmbeddedManifest } from '../types/manifest.js';

const SHA256_RE = /^[a-f0-9]{64}$/;
const NAMESPACE_RE = /^local\.mcpb\.[a-z0-9-]+\.[a-z0-9-]+$/;
const SOURCE_COMMIT_RE = /^[a-f0-9]{40}$/;
const VALID_ARCHES: ReadonlyArray<'darwin-arm64' | 'darwin-x64'> = [
  'darwin-arm64',
  'darwin-x64',
];

/**
 * Read and validate the embedded manifest JSON file at the given absolute
 * path. Returns the parsed + validated manifest, or throws with a clear
 * message indicating the offending field on any validation error.
 *
 * Failures bucket into three classes:
 *   - File I/O: missing file, unreadable file (rethrown with context)
 *   - JSON parse: malformed JSON (rethrown with context)
 *   - Schema: missing/wrong-typed/wrong-shaped fields (descriptive Error)
 */
export async function readEmbeddedManifest(
  manifestAbsPath: string,
): Promise<EmbeddedManifest> {
  let raw: string;
  try {
    raw = await readFile(manifestAbsPath, 'utf8');
  } catch (err) {
    const code =
      err !== null && typeof err === 'object' && 'code' in err
        ? (err as { code: unknown }).code
        : undefined;
    if (code === 'ENOENT') {
      throw new Error(
        `embedded manifest not found at ${manifestAbsPath} (file-not-found): the concierge-setup binary appears to be packaged incorrectly`,
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `failed to read embedded manifest at ${manifestAbsPath}: ${message}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `embedded manifest at ${manifestAbsPath} is not valid JSON (parse-error): ${message}`,
    );
  }

  return validateManifest(parsed, manifestAbsPath);
}

// --- internal validation helpers ---------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function requireField(
  obj: Record<string, unknown>,
  field: string,
  ctx: string,
): unknown {
  if (!(field in obj)) {
    throw new Error(
      `embedded manifest invalid: missing required field "${ctx}.${field}"`,
    );
  }
  return obj[field];
}

function requireNonEmptyString(
  value: unknown,
  field: string,
): string {
  if (typeof value !== 'string') {
    throw new Error(
      `embedded manifest invalid: field "${field}" must be a string (got ${typeof value})`,
    );
  }
  if (value.length === 0) {
    throw new Error(
      `embedded manifest invalid: field "${field}" must be a non-empty string`,
    );
  }
  return value;
}

function requireMatch(
  value: unknown,
  field: string,
  re: RegExp,
  shapeDescription: string,
): string {
  const s = requireNonEmptyString(value, field);
  if (!re.test(s)) {
    throw new Error(
      `embedded manifest invalid: field "${field}" must match ${shapeDescription} (got "${s}")`,
    );
  }
  return s;
}

function validateManifest(
  parsed: unknown,
  manifestAbsPath: string,
): EmbeddedManifest {
  if (!isPlainObject(parsed)) {
    throw new Error(
      `embedded manifest at ${manifestAbsPath} invalid: top-level must be a JSON object (got ${
        Array.isArray(parsed) ? 'array' : typeof parsed
      })`,
    );
  }

  const schemaVersion = requireField(parsed, 'schemaVersion', 'root');
  if (schemaVersion !== 1) {
    throw new Error(
      `embedded manifest invalid: field "schemaVersion" must be the literal 1 (got ${JSON.stringify(
        schemaVersion,
      )})`,
    );
  }

  const setupVersion = requireNonEmptyString(
    requireField(parsed, 'setupVersion', 'root'),
    'setupVersion',
  );

  const bundledMcpbRaw = requireField(parsed, 'bundledMcpb', 'root');
  if (!isPlainObject(bundledMcpbRaw)) {
    throw new Error(
      'embedded manifest invalid: field "bundledMcpb" must be a JSON object',
    );
  }

  const filename = requireNonEmptyString(
    requireField(bundledMcpbRaw, 'filename', 'bundledMcpb'),
    'bundledMcpb.filename',
  );
  const version = requireNonEmptyString(
    requireField(bundledMcpbRaw, 'version', 'bundledMcpb'),
    'bundledMcpb.version',
  );
  const sha256 = requireMatch(
    requireField(bundledMcpbRaw, 'sha256', 'bundledMcpb'),
    'bundledMcpb.sha256',
    SHA256_RE,
    '64 lowercase hex chars (/^[a-f0-9]{64}$/)',
  );

  const archRaw = requireField(bundledMcpbRaw, 'arch', 'bundledMcpb');
  const archStr = requireNonEmptyString(archRaw, 'bundledMcpb.arch');
  const archMatch = VALID_ARCHES.find((a) => a === archStr);
  if (archMatch === undefined) {
    throw new Error(
      `embedded manifest invalid: field "bundledMcpb.arch" must be one of ${VALID_ARCHES.join(
        ', ',
      )} (got "${archStr}")`,
    );
  }
  const arch: 'darwin-arm64' | 'darwin-x64' = archMatch;

  const namespace = requireMatch(
    requireField(bundledMcpbRaw, 'namespace', 'bundledMcpb'),
    'bundledMcpb.namespace',
    NAMESPACE_RE,
    '/^local\\.mcpb\\.[a-z0-9-]+\\.[a-z0-9-]+$/',
  );
  const buildId = requireNonEmptyString(
    requireField(bundledMcpbRaw, 'buildId', 'bundledMcpb'),
    'bundledMcpb.buildId',
  );

  const buildTimeStr = requireNonEmptyString(
    requireField(bundledMcpbRaw, 'buildTime', 'bundledMcpb'),
    'bundledMcpb.buildTime',
  );
  const parsedDate = new Date(buildTimeStr);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new Error(
      `embedded manifest invalid: field "bundledMcpb.buildTime" must parse as a valid Date (got "${buildTimeStr}")`,
    );
  }

  const sourceCommit = requireMatch(
    requireField(bundledMcpbRaw, 'sourceCommit', 'bundledMcpb'),
    'bundledMcpb.sourceCommit',
    SOURCE_COMMIT_RE,
    '40-char lowercase hex git sha (/^[a-f0-9]{40}$/)',
  );

  return {
    schemaVersion: 1,
    bundledMcpb: {
      filename,
      version,
      sha256,
      arch,
      namespace,
      buildId,
      buildTime: buildTimeStr,
      sourceCommit,
    },
    setupVersion,
  };
}
