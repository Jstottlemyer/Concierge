// D2: hand-rolled argv parser for the `concierge-setup` binary. Dispatches to
// either the orchestrator (default) or the diagnose phase. Intentionally
// dependency-free + dependency-injected so it tests cleanly without spawning
// real subprocesses or touching the filesystem.
//
// N17: this binary exposes ONLY --diagnose / --ascii / --version / --help.
// Every other verb (--update, --reauth, --uninstall, --repair, etc.) MUST
// fail fast with a pointer to the curl one-liner. The unknown-flag path is
// part of the user contract — keep it in sync with the help text below.

const HELP_TEXT = `concierge-setup — one-shot installer for Concierge

Usage:
  concierge-setup                        Run the setup wizard
  concierge-setup --diagnose [--bundle] [--full]
                                         Print or bundle the diagnostic report
  concierge-setup --ascii                Force ASCII-only output (no Unicode glyphs)
  concierge-setup --version              Print version and exit
  concierge-setup --help                 Show this message

This binary intentionally exposes no other verbs. For update / re-auth /
uninstall, re-run the curl one-liner from https://jstottlemyer.github.io/Concierge/
or follow the project docs.
`;

const UNKNOWN_FLAG_HINT =
  "v2.0 exposes only --diagnose, --ascii, --version, --help. " +
  "Additional verbs require a new spec (N17). See --help.";

export interface CliResult {
  exitCode: number;
}

export interface CliOptions {
  argv: readonly string[];
  runOrchestrator: (opts: {
    homedir: string;
    unpackedDistIndexJsPath: string;
    assetsDir?: string;
    ascii: boolean;
  }) => Promise<{ exitCode: number }>;
  runDiagnose: (opts: {
    homedir: string;
    mode: 'text' | 'bundle';
    full: boolean;
  }) => Promise<{ exitCode: number }>;
  homedir: string;
  unpackedDistIndexJsPath: string;
  assetsDir?: string;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

/** Resolve __CONCIERGE_SETUP_VERSION__ with a runtime fallback for vitest. */
function resolveSetupVersion(): string {
  const g = globalThis as { __CONCIERGE_SETUP_VERSION__?: unknown };
  if (typeof g.__CONCIERGE_SETUP_VERSION__ === 'string') {
    return g.__CONCIERGE_SETUP_VERSION__;
  }
  if (typeof __CONCIERGE_SETUP_VERSION__ !== 'undefined') {
    return __CONCIERGE_SETUP_VERSION__;
  }
  return '0.0.0-dev';
}

function unknownFlag(
  stderr: NodeJS.WritableStream,
  flag: string,
): CliResult {
  stderr.write(
    `concierge-setup: unknown flag '${flag}'. ${UNKNOWN_FLAG_HINT}\n`,
  );
  return { exitCode: 2 };
}

export async function runCli(options: CliOptions): Promise<CliResult> {
  const { argv, stdout, stderr } = options;

  // Empty argv → default orchestrator run, ascii=false.
  if (argv.length === 0) {
    return invokeOrchestrator(options, false);
  }

  // Single-arg fast paths.
  const first = argv[0];

  if (first === '--help') {
    if (argv.length !== 1) return unknownFlag(stderr, argv[1] ?? '');
    stdout.write(HELP_TEXT);
    return { exitCode: 0 };
  }

  if (first === '--version') {
    if (argv.length !== 1) return unknownFlag(stderr, argv[1] ?? '');
    stdout.write(`concierge-setup v${resolveSetupVersion()}\n`);
    return { exitCode: 0 };
  }

  if (first === '--ascii') {
    if (argv.length !== 1) return unknownFlag(stderr, argv[1] ?? '');
    return invokeOrchestrator(options, true);
  }

  if (first === '--diagnose') {
    return parseAndRunDiagnose(options, argv.slice(1));
  }

  // Anything else (positionals, --update, --reauth, -h, --, etc.) fails fast.
  return unknownFlag(stderr, first ?? '');
}

async function parseAndRunDiagnose(
  options: CliOptions,
  rest: readonly string[],
): Promise<CliResult> {
  const { stderr, runDiagnose, homedir } = options;
  let mode: 'text' | 'bundle' = 'text';
  let full = false;
  let sawBundle = false;
  let sawFull = false;

  for (const arg of rest) {
    if (arg === '--bundle') {
      if (sawBundle) return unknownFlag(stderr, arg);
      sawBundle = true;
      mode = 'bundle';
    } else if (arg === '--full') {
      if (sawFull) return unknownFlag(stderr, arg);
      sawFull = true;
      full = true;
    } else {
      return unknownFlag(stderr, arg);
    }
  }

  try {
    const res = await runDiagnose({ homedir, mode, full });
    return { exitCode: res.exitCode };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stderr.write(`concierge-setup: diagnose failed: ${msg}\n`);
    return { exitCode: 3 };
  }
}

async function invokeOrchestrator(
  options: CliOptions,
  ascii: boolean,
): Promise<CliResult> {
  const { runOrchestrator, homedir, unpackedDistIndexJsPath, assetsDir, stderr } =
    options;
  try {
    const orchOpts: {
      homedir: string;
      unpackedDistIndexJsPath: string;
      assetsDir?: string;
      ascii: boolean;
    } = { homedir, unpackedDistIndexJsPath, ascii };
    if (assetsDir !== undefined) orchOpts.assetsDir = assetsDir;
    const res = await runOrchestrator(orchOpts);
    return { exitCode: res.exitCode };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stderr.write(`concierge-setup: orchestrator failed: ${msg}\n`);
    return { exitCode: 3 };
  }
}
