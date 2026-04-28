#!/usr/bin/env node
// D5: `concierge-setup` binary entry point. Pure wiring between
//   - D2  cli.ts (argv parser + dispatch)
//   - D1  orchestrator.ts (run-the-pipeline composition)
//   - D3  ui/index.ts (terminal UI sink + Unicode auto-detect)
//   - C8  phases/diagnose.ts (--diagnose phase)
//
// `main` is exported (not auto-invoked under import) so tests can drive it
// without spawning a child process. The bottom-of-file guard runs `main()`
// only when this module is invoked as the program (i.e. node executes it
// directly), matching the pattern documented at the bottom of this file.

import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

import { runCli } from './cli.js';
import { runOrchestrator } from './orchestrator.js';
import { runDiagnose } from './phases/diagnose.js';
import { resolveAssetsDir, resolveUnpackedDistIndexJsPath } from './paths.js';
import { createTerminalUI, shouldUseUnicode } from './ui/index.js';

export interface MainOptions {
  argv?: readonly string[];
  stdout?: NodeJS.WritableStream;
  stderr?: NodeJS.WritableStream;
  stdin?: NodeJS.ReadableStream;
  /** Override homedir (tests). Defaults to `os.homedir()`. */
  homedir?: string;
  /** Override env (tests). Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Override TTY detection (tests). Defaults to `process.stdout.isTTY`. */
  isTTY?: boolean;
}

export interface MainResult {
  exitCode: number;
}

/** Wire D2/D1/D3/C8 together and run the requested verb.
 *
 *  Returns the resolved exit code rather than calling `process.exit`, so
 *  tests can drive `main()` directly. The bottom-of-file guard does the
 *  process exit when this module runs as the program. */
export async function main(opts: MainOptions = {}): Promise<MainResult> {
  const argv = opts.argv ?? process.argv.slice(2);
  const stdout = opts.stdout ?? process.stdout;
  const stderr = opts.stderr ?? process.stderr;
  const stdin = opts.stdin ?? process.stdin;
  const home = opts.homedir ?? homedir();
  const env = opts.env ?? process.env;
  const isTTY = opts.isTTY ?? Boolean((process.stdout as { isTTY?: boolean }).isTTY);

  const result = await runCli({
    argv,
    homedir: home,
    unpackedDistIndexJsPath: resolveUnpackedDistIndexJsPath(),
    assetsDir: resolveAssetsDir(),
    stdout,
    stderr,
    runOrchestrator: async (orchOpts) => {
      const useUnicode = !orchOpts.ascii && shouldUseUnicode({
        isTTY,
        lang: env['LANG'],
      });
      const ui = createTerminalUI({
        stdout,
        stderr,
        stdin,
        ascii: !useUnicode,
      });
      const runOpts: Parameters<typeof runOrchestrator>[0] = {
        homedir: orchOpts.homedir,
        unpackedDistIndexJsPath: orchOpts.unpackedDistIndexJsPath,
        ui,
      };
      if (orchOpts.assetsDir !== undefined) {
        runOpts.assetsDir = orchOpts.assetsDir;
      }
      const r = await runOrchestrator(runOpts);
      return { exitCode: r.exitCode };
    },
    runDiagnose: async (diagOpts) => {
      // The diagnose phase returns { mode, output, sections }. In `text` mode
      // `output` is the rendered markdown body; in `bundle` mode it's the
      // absolute tarball path. Either way we surface it on stdout and exit 0
      // — diagnose is a read-only reporter and shouldn't fail the program
      // when individual sections error (those are surfaced inline as
      // `[error: ...]` markers per C8's contract).
      const r = await runDiagnose({
        mode: diagOpts.mode,
        full: diagOpts.full,
        homedir: diagOpts.homedir,
      });
      if (r.mode === 'bundle') {
        stdout.write(`Wrote diagnostic bundle to: ${r.output}\n`);
      } else {
        stdout.write(r.output);
      }
      return { exitCode: 0 };
    },
  });

  return { exitCode: result.exitCode };
}

/** True when this module is being executed as the program (vs. imported). */
function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return fileURLToPath(import.meta.url) === entry;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().then(
    (r) => {
      process.exit(r.exitCode);
    },
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`concierge-setup: fatal error: ${msg}\n`);
      process.exit(3);
    },
  );
}
