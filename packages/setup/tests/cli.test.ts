// D2 tests: cli.ts argv parser + dispatch.
//
// Strategy: pass dependency-injected stub runOrchestrator / runDiagnose
// functions plus Buffer-backed writable streams. Assert exit code, stdout /
// stderr capture, and which sink was invoked with what args.

import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';

import { runCli, type CliOptions } from '../src/cli.js';

interface BufferedStream extends Writable {
  buffered(): string;
}

function bufferStream(): BufferedStream {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk: Buffer | string, _enc, cb): void {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      cb();
    },
  }) as BufferedStream;
  stream.buffered = (): string => Buffer.concat(chunks).toString('utf8');
  return stream;
}

interface Harness {
  runOrchestrator: ReturnType<typeof vi.fn>;
  runDiagnose: ReturnType<typeof vi.fn>;
  stdout: BufferedStream;
  stderr: BufferedStream;
}

function makeHarness(opts?: {
  orchestratorExit?: number;
  diagnoseExit?: number;
  orchestratorThrow?: unknown;
}): Harness {
  const orchExit = opts?.orchestratorExit ?? 0;
  const diagExit = opts?.diagnoseExit ?? 0;
  const runOrchestrator = vi.fn(async () => {
    if (opts?.orchestratorThrow !== undefined) {
      throw opts.orchestratorThrow;
    }
    return { exitCode: orchExit };
  });
  const runDiagnose = vi.fn(async () => ({ exitCode: diagExit }));
  return {
    runOrchestrator,
    runDiagnose,
    stdout: bufferStream(),
    stderr: bufferStream(),
  };
}

function makeOptions(
  argv: readonly string[],
  h: Harness,
  overrides: Partial<CliOptions> = {},
): CliOptions {
  return {
    argv,
    runOrchestrator: h.runOrchestrator as unknown as CliOptions['runOrchestrator'],
    runDiagnose: h.runDiagnose as unknown as CliOptions['runDiagnose'],
    homedir: '/tmp/home',
    unpackedDistIndexJsPath: '/tmp/dist/index.js',
    assetsDir: '/tmp/assets',
    stdout: h.stdout,
    stderr: h.stderr,
    ...overrides,
  };
}

describe('runCli — happy paths', () => {
  it('1. no args → orchestrator with ascii=false, propagates exit', async () => {
    const h = makeHarness({ orchestratorExit: 0 });
    const res = await runCli(makeOptions([], h));
    expect(res.exitCode).toBe(0);
    expect(h.runOrchestrator).toHaveBeenCalledTimes(1);
    expect(h.runOrchestrator).toHaveBeenCalledWith({
      homedir: '/tmp/home',
      unpackedDistIndexJsPath: '/tmp/dist/index.js',
      assetsDir: '/tmp/assets',
      ascii: false,
    });
    expect(h.runDiagnose).not.toHaveBeenCalled();
  });

  it('1b. orchestrator non-zero exit propagates', async () => {
    const h = makeHarness({ orchestratorExit: 3 });
    const res = await runCli(makeOptions([], h));
    expect(res.exitCode).toBe(3);
  });

  it('2. --ascii → orchestrator with ascii=true', async () => {
    const h = makeHarness();
    const res = await runCli(makeOptions(['--ascii'], h));
    expect(res.exitCode).toBe(0);
    expect(h.runOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({ ascii: true }),
    );
  });

  it('3. --diagnose → diagnose mode=text full=false', async () => {
    const h = makeHarness();
    const res = await runCli(makeOptions(['--diagnose'], h));
    expect(res.exitCode).toBe(0);
    expect(h.runDiagnose).toHaveBeenCalledTimes(1);
    expect(h.runDiagnose).toHaveBeenCalledWith({
      homedir: '/tmp/home',
      mode: 'text',
      full: false,
    });
    expect(h.runOrchestrator).not.toHaveBeenCalled();
  });

  it('4. --diagnose --bundle → mode=bundle full=false', async () => {
    const h = makeHarness();
    await runCli(makeOptions(['--diagnose', '--bundle'], h));
    expect(h.runDiagnose).toHaveBeenCalledWith({
      homedir: '/tmp/home',
      mode: 'bundle',
      full: false,
    });
  });

  it('5. --diagnose --full → mode=text full=true', async () => {
    const h = makeHarness();
    await runCli(makeOptions(['--diagnose', '--full'], h));
    expect(h.runDiagnose).toHaveBeenCalledWith({
      homedir: '/tmp/home',
      mode: 'text',
      full: true,
    });
  });

  it('6. --diagnose --bundle --full → mode=bundle full=true', async () => {
    const h = makeHarness();
    await runCli(makeOptions(['--diagnose', '--bundle', '--full'], h));
    expect(h.runDiagnose).toHaveBeenCalledWith({
      homedir: '/tmp/home',
      mode: 'bundle',
      full: true,
    });
  });

  it('7. --diagnose --full --bundle (order does not matter)', async () => {
    const h = makeHarness();
    await runCli(makeOptions(['--diagnose', '--full', '--bundle'], h));
    expect(h.runDiagnose).toHaveBeenCalledWith({
      homedir: '/tmp/home',
      mode: 'bundle',
      full: true,
    });
  });

  it('diagnose exit code propagates', async () => {
    const h = makeHarness({ diagnoseExit: 7 });
    const res = await runCli(makeOptions(['--diagnose'], h));
    expect(res.exitCode).toBe(7);
  });
});

describe('runCli — meta flags', () => {
  it('8. --version → version on stdout, exit 0, sinks not called', async () => {
    const h = makeHarness();
    // Shim the tsup-injected define for the test environment.
    (globalThis as { __CONCIERGE_SETUP_VERSION__?: string }).__CONCIERGE_SETUP_VERSION__ =
      '1.2.3';
    try {
      const res = await runCli(makeOptions(['--version'], h));
      expect(res.exitCode).toBe(0);
      expect(h.stdout.buffered()).toContain('concierge-setup v1.2.3');
      expect(h.runOrchestrator).not.toHaveBeenCalled();
      expect(h.runDiagnose).not.toHaveBeenCalled();
    } finally {
      delete (globalThis as { __CONCIERGE_SETUP_VERSION__?: string })
        .__CONCIERGE_SETUP_VERSION__;
    }
  });

  it('--version with extra arg → unknown flag', async () => {
    const h = makeHarness();
    const res = await runCli(makeOptions(['--version', '--ascii'], h));
    expect(res.exitCode).toBe(2);
    expect(h.stderr.buffered()).toContain('unknown flag');
  });

  it('9. --help → help text on stdout, exit 0', async () => {
    const h = makeHarness();
    const res = await runCli(makeOptions(['--help'], h));
    expect(res.exitCode).toBe(0);
    const out = h.stdout.buffered();
    expect(out).toContain('concierge-setup');
    expect(out).toContain('--diagnose');
    expect(out).toContain('--ascii');
    expect(out).toContain('--version');
    expect(h.runOrchestrator).not.toHaveBeenCalled();
    expect(h.runDiagnose).not.toHaveBeenCalled();
  });

  it('--help with extra arg → unknown flag', async () => {
    const h = makeHarness();
    const res = await runCli(makeOptions(['--help', 'extra'], h));
    expect(res.exitCode).toBe(2);
  });

  it('--ascii with extra arg → unknown flag', async () => {
    const h = makeHarness();
    const res = await runCli(makeOptions(['--ascii', '--diagnose'], h));
    expect(res.exitCode).toBe(2);
    expect(h.runOrchestrator).not.toHaveBeenCalled();
  });
});

describe('runCli — N17 unknown flag enforcement', () => {
  it('10. --update → exit 2 with hint, orchestrator NOT called', async () => {
    const h = makeHarness();
    const res = await runCli(makeOptions(['--update'], h));
    expect(res.exitCode).toBe(2);
    const err = h.stderr.buffered();
    expect(err).toContain("unknown flag '--update'");
    expect(err).toContain('N17');
    expect(err).toContain('--help');
    expect(h.runOrchestrator).not.toHaveBeenCalled();
    expect(h.runDiagnose).not.toHaveBeenCalled();
  });

  it.each([
    '--reauth',
    '--uninstall',
    '--repair',
    '--upgrade',
    '--reset',
  ])('rejects forbidden verb %s', async (flag) => {
    const h = makeHarness();
    const res = await runCli(makeOptions([flag], h));
    expect(res.exitCode).toBe(2);
    expect(h.stderr.buffered()).toContain(`unknown flag '${flag}'`);
  });

  it('11. positional `install` → exit 2', async () => {
    const h = makeHarness();
    const res = await runCli(makeOptions(['install'], h));
    expect(res.exitCode).toBe(2);
    expect(h.stderr.buffered()).toContain("unknown flag 'install'");
    expect(h.runOrchestrator).not.toHaveBeenCalled();
  });

  it('12. --diagnose --bogus → exit 2', async () => {
    const h = makeHarness();
    const res = await runCli(makeOptions(['--diagnose', '--bogus'], h));
    expect(res.exitCode).toBe(2);
    expect(h.stderr.buffered()).toContain("unknown flag '--bogus'");
    expect(h.runDiagnose).not.toHaveBeenCalled();
  });

  it('--diagnose with positional → exit 2', async () => {
    const h = makeHarness();
    const res = await runCli(makeOptions(['--diagnose', 'now'], h));
    expect(res.exitCode).toBe(2);
    expect(h.runDiagnose).not.toHaveBeenCalled();
  });

  it('repeated --diagnose --diagnose → exit 2', async () => {
    const h = makeHarness();
    // Inner --diagnose is parsed as a flag-arg of the diagnose subcommand,
    // which is not in the {--bundle, --full} allowlist → unknown flag.
    const res = await runCli(makeOptions(['--diagnose', '--diagnose'], h));
    expect(res.exitCode).toBe(2);
    expect(h.runDiagnose).not.toHaveBeenCalled();
  });

  it('repeated --diagnose --bundle --bundle → exit 2', async () => {
    const h = makeHarness();
    const res = await runCli(
      makeOptions(['--diagnose', '--bundle', '--bundle'], h),
    );
    expect(res.exitCode).toBe(2);
    expect(h.runDiagnose).not.toHaveBeenCalled();
  });

  it('repeated --diagnose --full --full → exit 2', async () => {
    const h = makeHarness();
    const res = await runCli(makeOptions(['--diagnose', '--full', '--full'], h));
    expect(res.exitCode).toBe(2);
  });

  it('13. -h short flag → exit 2 (only --help long form is accepted)', async () => {
    const h = makeHarness();
    const res = await runCli(makeOptions(['-h'], h));
    expect(res.exitCode).toBe(2);
    expect(h.stderr.buffered()).toContain("unknown flag '-h'");
  });

  it('combined short flags -vh → exit 2', async () => {
    const h = makeHarness();
    const res = await runCli(makeOptions(['-vh'], h));
    expect(res.exitCode).toBe(2);
  });

  it("14a. bare '--' → exit 2", async () => {
    const h = makeHarness();
    const res = await runCli(makeOptions(['--'], h));
    expect(res.exitCode).toBe(2);
    expect(h.stderr.buffered()).toContain("unknown flag '--'");
  });

  it("14b. '--' followed by args → exit 2", async () => {
    const h = makeHarness();
    const res = await runCli(makeOptions(['--', 'foo', 'bar'], h));
    expect(res.exitCode).toBe(2);
    expect(h.runOrchestrator).not.toHaveBeenCalled();
  });

  it("'--ascii' followed by '--' → exit 2", async () => {
    const h = makeHarness();
    const res = await runCli(makeOptions(['--ascii', '--'], h));
    expect(res.exitCode).toBe(2);
  });
});

describe('runCli — failure semantics', () => {
  it('15. orchestrator throwing → exit 3 + one-line stderr', async () => {
    const h = makeHarness({ orchestratorThrow: new Error('boom') });
    const res = await runCli(makeOptions([], h));
    expect(res.exitCode).toBe(3);
    const err = h.stderr.buffered();
    expect(err).toContain('orchestrator failed');
    expect(err).toContain('boom');
    expect(err.split('\n').filter((l) => l.length > 0)).toHaveLength(1);
  });

  it('orchestrator throwing non-Error → exit 3, stringified', async () => {
    const h = makeHarness({ orchestratorThrow: 'string-error' });
    const res = await runCli(makeOptions([], h));
    expect(res.exitCode).toBe(3);
    expect(h.stderr.buffered()).toContain('string-error');
  });

  it('diagnose throwing → exit 3 + one-line stderr', async () => {
    const h = makeHarness();
    h.runDiagnose.mockImplementationOnce(async () => {
      throw new Error('diag-boom');
    });
    const res = await runCli(makeOptions(['--diagnose'], h));
    expect(res.exitCode).toBe(3);
    const err = h.stderr.buffered();
    expect(err).toContain('diagnose failed');
    expect(err).toContain('diag-boom');
  });
});
