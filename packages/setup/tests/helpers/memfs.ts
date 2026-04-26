// G0: In-memory filesystem helper for orchestrator unit tests.
//
// Implements the minimal `node:fs/promises` + `node:fs` (sync subset) surface
// the orchestrator needs: read/write/mkdir/rm/stat/readdir/access/rename/chmod
// async, plus existsSync/readFileSync/writeFileSync/mkdirSync/openSync/closeSync
// sync. Errors mirror Node's shapes (`{ code: 'ENOENT' | 'EEXIST' | ... }`)
// so orchestrator code that branches on `err.code` works correctly.
//
// `install()` / `uninstall()` use `vi.doMock` / `vi.doUnmock` so the same
// helper instance can be flipped on/off across tests. NOTE: because Vitest
// hoists `vi.mock` (not `vi.doMock`), tests that need the FS substitution
// active *at module load time* of the system-under-test should call
// `await import(...)` after `install()` (dynamic import bypasses hoisting).
//
// Path normalization: POSIX-only (`path.posix.normalize`). macOS-only project,
// per repo CLAUDE.md — no Windows path handling.
//
// Strict-TS notes:
//   - No `any`. Mock function types are explicit.
//   - `noUncheckedIndexedAccess`: defensive checks on Map.get / split results.
//   - `exactOptionalPropertyTypes`: optional fields are conditional.

import { posix as path } from 'node:path';
import { vi } from 'vitest';

// Node FS error codes we model.
type FsErrorCode =
  | 'ENOENT'
  | 'EEXIST'
  | 'EISDIR'
  | 'ENOTDIR'
  | 'ENOTEMPTY'
  | 'EBADF';

class FsError extends Error {
  public readonly code: FsErrorCode;
  public readonly errno: number;
  public readonly syscall: string;
  public readonly path: string;
  constructor(code: FsErrorCode, syscall: string, p: string) {
    super(`${code}: ${syscall} ${p}`);
    this.code = code;
    this.errno = -1;
    this.syscall = syscall;
    this.path = p;
  }
}

interface FileNode {
  type: 'file';
  contents: string;
  mode: number;
}

interface DirNode {
  type: 'dir';
  mode: number;
}

type Node = FileNode | DirNode;

interface FakeStats {
  isFile(): boolean;
  isDirectory(): boolean;
  size: number;
  mode: number;
}

export interface MemFs {
  /** Reset to empty state. */
  reset(): void;
  /** Pre-populate the in-memory FS with files. Path -> contents. */
  preload(files: Record<string, string>): void;
  /** Get the current state of all files (path -> contents). */
  snapshot(): Record<string, string>;
  /** Apply via vitest's vi.doMock to substitute fs/promises and fs. */
  install(): void;
  /** Remove the vi.doMock substitution. */
  uninstall(): void;
}

function normalize(p: string): string {
  if (p.length === 0) return '/';
  // Force absolute. Tests that pass relative paths get them rooted at /.
  const abs = p.startsWith('/') ? p : `/${p}`;
  const norm = path.normalize(abs);
  // Trim trailing slash unless root.
  if (norm.length > 1 && norm.endsWith('/')) return norm.slice(0, -1);
  return norm;
}

function parentDir(p: string): string {
  const norm = normalize(p);
  if (norm === '/') return '/';
  const idx = norm.lastIndexOf('/');
  if (idx <= 0) return '/';
  return norm.slice(0, idx);
}

export function createMemFs(): MemFs {
  // Map of normalized absolute path -> Node. Always contains '/'.
  const tree = new Map<string, Node>();
  tree.set('/', { type: 'dir', mode: 0o755 });

  // Track open synthetic file descriptors so closeSync is well-defined.
  const openFds = new Set<number>();
  let nextFd = 100;

  function ensureParentDirExists(p: string, syscall: string): void {
    const parent = parentDir(p);
    const parentNode = tree.get(parent);
    if (parentNode === undefined) {
      throw new FsError('ENOENT', syscall, p);
    }
    if (parentNode.type !== 'dir') {
      throw new FsError('ENOTDIR', syscall, p);
    }
  }

  function getNode(p: string, syscall: string): Node {
    const norm = normalize(p);
    const node = tree.get(norm);
    if (node === undefined) {
      throw new FsError('ENOENT', syscall, norm);
    }
    return node;
  }

  function statOf(p: string): FakeStats {
    const node = getNode(p, 'stat');
    if (node.type === 'file') {
      const size = node.contents.length;
      return {
        isFile: () => true,
        isDirectory: () => false,
        size,
        mode: node.mode,
      };
    }
    return {
      isFile: () => false,
      isDirectory: () => true,
      size: 0,
      mode: node.mode,
    };
  }

  function mkdirImpl(
    p: string,
    options: { recursive?: boolean } | undefined,
    syscall: string,
  ): void {
    const norm = normalize(p);
    if (norm === '/') return; // root always exists
    const recursive = options?.recursive === true;
    const existing = tree.get(norm);
    if (existing !== undefined) {
      if (existing.type === 'dir') {
        if (recursive) return;
        throw new FsError('EEXIST', syscall, norm);
      }
      throw new FsError('EEXIST', syscall, norm);
    }
    const parent = parentDir(norm);
    if (!tree.has(parent)) {
      if (recursive) {
        mkdirImpl(parent, { recursive: true }, syscall);
      } else {
        throw new FsError('ENOENT', syscall, norm);
      }
    }
    const parentNode = tree.get(parent);
    if (parentNode === undefined || parentNode.type !== 'dir') {
      throw new FsError('ENOTDIR', syscall, norm);
    }
    tree.set(norm, { type: 'dir', mode: 0o755 });
  }

  function writeFileImpl(p: string, data: string, syscall: string): void {
    const norm = normalize(p);
    ensureParentDirExists(norm, syscall);
    const existing = tree.get(norm);
    if (existing !== undefined && existing.type === 'dir') {
      throw new FsError('EISDIR', syscall, norm);
    }
    tree.set(norm, { type: 'file', contents: data, mode: 0o644 });
  }

  function readFileImpl(p: string, syscall: string): string {
    const node = getNode(p, syscall);
    if (node.type !== 'file') {
      throw new FsError('EISDIR', syscall, normalize(p));
    }
    return node.contents;
  }

  function rmImpl(
    p: string,
    options: { recursive?: boolean; force?: boolean } | undefined,
    syscall: string,
  ): void {
    const norm = normalize(p);
    const recursive = options?.recursive === true;
    const force = options?.force === true;
    const node = tree.get(norm);
    if (node === undefined) {
      if (force) return;
      throw new FsError('ENOENT', syscall, norm);
    }
    if (node.type === 'dir') {
      // Find children
      const prefix = norm === '/' ? '/' : `${norm}/`;
      const children: string[] = [];
      for (const key of tree.keys()) {
        if (key !== norm && key.startsWith(prefix)) {
          children.push(key);
        }
      }
      if (children.length > 0 && !recursive) {
        throw new FsError('ENOTEMPTY', syscall, norm);
      }
      for (const child of children) tree.delete(child);
    }
    if (norm !== '/') tree.delete(norm);
  }

  function readdirImpl(p: string, syscall: string): string[] {
    const norm = normalize(p);
    const node = tree.get(norm);
    if (node === undefined) throw new FsError('ENOENT', syscall, norm);
    if (node.type !== 'dir') throw new FsError('ENOTDIR', syscall, norm);
    const prefix = norm === '/' ? '/' : `${norm}/`;
    const names = new Set<string>();
    for (const key of tree.keys()) {
      if (key === norm) continue;
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      const slashIdx = rest.indexOf('/');
      names.add(slashIdx === -1 ? rest : rest.slice(0, slashIdx));
    }
    return [...names].sort();
  }

  function renameImpl(from: string, to: string, syscall: string): void {
    const src = normalize(from);
    const dst = normalize(to);
    const node = tree.get(src);
    if (node === undefined) throw new FsError('ENOENT', syscall, src);
    ensureParentDirExists(dst, syscall);
    if (node.type === 'dir') {
      // Move subtree
      const prefix = `${src}/`;
      const movers: Array<[string, Node]> = [];
      for (const [k, v] of tree.entries()) {
        if (k === src || k.startsWith(prefix)) movers.push([k, v]);
      }
      for (const [k] of movers) tree.delete(k);
      for (const [k, v] of movers) {
        const newKey = k === src ? dst : `${dst}${k.slice(src.length)}`;
        tree.set(newKey, v);
      }
    } else {
      tree.delete(src);
      tree.set(dst, node);
    }
  }

  function chmodImpl(p: string, mode: number, syscall: string): void {
    const node = getNode(p, syscall);
    node.mode = mode;
  }

  function accessImpl(p: string, syscall: string): void {
    getNode(p, syscall);
  }

  // openSync('wx') semantics: fail with EEXIST if file exists; otherwise
  // create empty file and return synthetic fd.
  function openSyncImpl(p: string, flags: string): number {
    const norm = normalize(p);
    if (flags === 'wx' || flags === 'ax') {
      if (tree.has(norm)) throw new FsError('EEXIST', 'open', norm);
      ensureParentDirExists(norm, 'open');
      tree.set(norm, { type: 'file', contents: '', mode: 0o644 });
    } else if (flags === 'r') {
      if (!tree.has(norm)) throw new FsError('ENOENT', 'open', norm);
    } else {
      // Treat 'w'/'a'/etc. as create-or-truncate for our purposes.
      if (!tree.has(norm)) {
        ensureParentDirExists(norm, 'open');
        tree.set(norm, { type: 'file', contents: '', mode: 0o644 });
      }
    }
    const fd = nextFd++;
    openFds.add(fd);
    return fd;
  }

  function closeSyncImpl(fd: number): void {
    if (!openFds.has(fd)) throw new FsError('EBADF', 'close', String(fd));
    openFds.delete(fd);
  }

  // --- Module factories for vi.doMock ---------------------------------

  // Async factory: matches the surface of `node:fs/promises`.
  function buildPromisesModule(): Record<string, unknown> {
    return {
      readFile: vi.fn(async (p: string): Promise<string> => readFileImpl(p, 'open')),
      writeFile: vi.fn(async (p: string, data: string): Promise<void> => {
        writeFileImpl(p, data, 'open');
      }),
      mkdir: vi.fn(
        async (p: string, options?: { recursive?: boolean }): Promise<void> => {
          mkdirImpl(p, options, 'mkdir');
        },
      ),
      rm: vi.fn(
        async (
          p: string,
          options?: { recursive?: boolean; force?: boolean },
        ): Promise<void> => {
          rmImpl(p, options, 'rm');
        },
      ),
      stat: vi.fn(async (p: string): Promise<FakeStats> => statOf(p)),
      readdir: vi.fn(async (p: string): Promise<string[]> => readdirImpl(p, 'scandir')),
      access: vi.fn(async (p: string): Promise<void> => {
        accessImpl(p, 'access');
      }),
      rename: vi.fn(async (from: string, to: string): Promise<void> => {
        renameImpl(from, to, 'rename');
      }),
      chmod: vi.fn(async (p: string, mode: number): Promise<void> => {
        chmodImpl(p, mode, 'chmod');
      }),
    };
  }

  function buildSyncModule(): Record<string, unknown> {
    return {
      existsSync: vi.fn((p: string): boolean => tree.has(normalize(p))),
      readFileSync: vi.fn((p: string): string => readFileImpl(p, 'open')),
      writeFileSync: vi.fn((p: string, data: string): void => {
        writeFileImpl(p, data, 'open');
      }),
      mkdirSync: vi.fn((p: string, options?: { recursive?: boolean }): void => {
        mkdirImpl(p, options, 'mkdir');
      }),
      openSync: vi.fn((p: string, flags: string): number => openSyncImpl(p, flags)),
      closeSync: vi.fn((fd: number): void => closeSyncImpl(fd)),
      // Surface a default export too, since some code uses `import fs from 'node:fs'`.
      default: undefined as unknown,
    };
  }

  let installed = false;

  return {
    reset(): void {
      tree.clear();
      tree.set('/', { type: 'dir', mode: 0o755 });
      openFds.clear();
      nextFd = 100;
    },
    preload(files: Record<string, string>): void {
      for (const [p, contents] of Object.entries(files)) {
        const norm = normalize(p);
        // Recursively create parent dirs.
        const parent = parentDir(norm);
        if (parent !== '/' && !tree.has(parent)) {
          mkdirImpl(parent, { recursive: true }, 'mkdir');
        }
        tree.set(norm, { type: 'file', contents, mode: 0o644 });
      }
    },
    snapshot(): Record<string, string> {
      const out: Record<string, string> = {};
      for (const [k, v] of tree.entries()) {
        if (v.type === 'file') out[k] = v.contents;
      }
      return out;
    },
    install(): void {
      if (installed) return;
      installed = true;
      const promisesModule = buildPromisesModule();
      const syncModule = buildSyncModule();
      // Self-reference for `default` export.
      syncModule['default'] = syncModule;
      vi.doMock('node:fs/promises', () => promisesModule);
      vi.doMock('node:fs', () => syncModule);
    },
    uninstall(): void {
      if (!installed) return;
      installed = false;
      vi.doUnmock('node:fs/promises');
      vi.doUnmock('node:fs');
    },
  };
}
