import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createMemFs } from './memfs.js';

// Each test installs the mock, dynamically imports `node:fs/promises` /
// `node:fs` so the doMock substitution applies, exercises the helper, then
// uninstalls + resets state. This mirrors how downstream orchestrator tests
// will use the helper.

const memfs = createMemFs();

beforeEach(() => {
  memfs.reset();
  memfs.install();
});

afterEach(() => {
  memfs.uninstall();
});

describe('createMemFs', () => {
  it('preload + readFile returns the preloaded contents', async () => {
    memfs.preload({ '/etc/hello.txt': 'hi there' });
    const fsp = await import('node:fs/promises');
    const contents = await fsp.readFile('/etc/hello.txt');
    expect(contents).toBe('hi there');
  });

  it('writeFile then readFile round-trips data', async () => {
    const fsp = await import('node:fs/promises');
    await fsp.mkdir('/tmp', { recursive: true });
    await fsp.writeFile('/tmp/note.txt', 'persisted');
    const back = await fsp.readFile('/tmp/note.txt');
    expect(back).toBe('persisted');
  });

  it('mkdir creates a directory and stat reports isDirectory', async () => {
    const fsp = await import('node:fs/promises');
    await fsp.mkdir('/var/data', { recursive: true });
    const st = (await fsp.stat('/var/data')) as unknown as {
      isDirectory: () => boolean;
      isFile: () => boolean;
    };
    expect(st.isDirectory()).toBe(true);
    expect(st.isFile()).toBe(false);
  });

  it("openSync('wx') throws EEXIST when the target file already exists", async () => {
    memfs.preload({ '/var/lock/app.lock': '' });
    const fs = await import('node:fs');
    expect(() => fs.openSync('/var/lock/app.lock', 'wx')).toThrowError(
      expect.objectContaining({ code: 'EEXIST' }) as unknown as Error,
    );
  });

  it("openSync('wx') succeeds and creates the file when not present", async () => {
    const fs = await import('node:fs');
    const fsp = await import('node:fs/promises');
    await fsp.mkdir('/var/lock', { recursive: true });
    const fd = fs.openSync('/var/lock/new.lock', 'wx');
    expect(typeof fd).toBe('number');
    fs.closeSync(fd);
    expect(fs.existsSync('/var/lock/new.lock')).toBe(true);
  });

  it('rm with recursive removes a directory and all its contents', async () => {
    memfs.preload({
      '/proj/a.txt': 'A',
      '/proj/sub/b.txt': 'B',
      '/proj/sub/c.txt': 'C',
    });
    const fsp = await import('node:fs/promises');
    await fsp.rm('/proj', { recursive: true });
    expect(memfs.snapshot()).toEqual({});
  });

  it('snapshot returns only file paths and contents', async () => {
    memfs.preload({ '/a.txt': 'A', '/b/c.txt': 'C' });
    const snap = memfs.snapshot();
    expect(snap).toEqual({ '/a.txt': 'A', '/b/c.txt': 'C' });
  });

  it('readFile on a missing path rejects with ENOENT', async () => {
    const fsp = await import('node:fs/promises');
    await expect(fsp.readFile('/no/such.txt')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
