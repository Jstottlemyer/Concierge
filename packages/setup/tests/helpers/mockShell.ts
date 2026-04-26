// G0: Subprocess-mock helper for orchestrator unit tests.
//
// Unlike `packages/google-workspace/tests/helpers/gws-mock.ts` (which writes a
// real on-disk fake binary so the GWS subprocess runner spawns an actual
// child), this helper is a pure in-process stub. The orchestrator (forthcoming
// in `packages/setup/src/`) wraps subprocess invocations behind a single
// `runner(command, args, options)` boundary; tests inject `MockShell.runner`
// in place of the real implementation and assert on what was invoked.
//
// Strict-TS notes:
//   - No `any`. All recorded data is typed.
//   - `readonly` arrays in the public surface; we copy on record/return.
//   - `exactOptionalPropertyTypes` requires guarding undefined fields.

import { expect } from 'vitest';

export interface MockShellResponse {
  stdout?: string;
  stderr?: string;
  exitCode: number;
  /**
   * If set, stderr is delivered as line-by-line streams via EventEmitter
   * (useful for the gws auth login port-collision case where the orchestrator
   * must catch a single stderr line as it appears, not after process exit).
   *
   * v1: lines are concatenated into stderr and returned synchronously after
   * the runner promise resolves. TODO: full stream-during-execution support
   * (real EventEmitter wired into the runner result) once a downstream test
   * requires it.
   */
  stderrStream?: readonly string[];
}

export interface MockShellInvocation {
  command: string; // 'gws'
  args: readonly string[]; // ['auth', 'login', '--services', 'gmail']
  env?: Record<string, string>;
  cwd?: string;
}

export interface MockShell {
  /** Queue a response for the NEXT invocation matching `commandPattern`. */
  enqueue(commandPattern: string | RegExp, response: MockShellResponse): void;
  /** Return all invocations recorded so far (in order). */
  invocations(): readonly MockShellInvocation[];
  /** Assert the recorded invocation sequence matches `expected` (command-only by default). */
  expectCommands(expected: readonly string[]): void;
  /** Reset queue + invocations between tests. */
  reset(): void;
  /** The mock function suitable for vitest `vi.mock` of a runner module. */
  runner: (
    command: string,
    args: readonly string[],
    options?: { env?: Record<string, string>; cwd?: string },
  ) => Promise<MockShellResponse>;
}

interface QueuedResponse {
  pattern: string | RegExp;
  response: MockShellResponse;
}

function commandLine(command: string, args: readonly string[]): string {
  if (args.length === 0) return command;
  return `${command} ${args.join(' ')}`;
}

function patternMatches(pattern: string | RegExp, line: string): boolean {
  if (typeof pattern === 'string') {
    // Substring match — lets callers enqueue against either the bare command
    // ('gws') or a fuller fragment ('gws auth login').
    return line.includes(pattern);
  }
  return pattern.test(line);
}

function materializeResponse(response: MockShellResponse): MockShellResponse {
  // If `stderrStream` is set, fold its lines into stderr (joined with '\n')
  // before returning. v1 simplification — see header TODO.
  if (response.stderrStream === undefined || response.stderrStream.length === 0) {
    return response;
  }
  const streamed = response.stderrStream.join('\n');
  const existing = response.stderr ?? '';
  const combinedStderr = existing.length > 0 ? `${existing}\n${streamed}` : streamed;
  return {
    ...response,
    stderr: combinedStderr,
  };
}

export function createMockShell(): MockShell {
  const queue: QueuedResponse[] = [];
  const recorded: MockShellInvocation[] = [];

  const runner = (
    command: string,
    args: readonly string[],
    options?: { env?: Record<string, string>; cwd?: string },
  ): Promise<MockShellResponse> => {
    const invocation: MockShellInvocation = (() => {
      const base: MockShellInvocation = {
        command,
        args: [...args],
      };
      if (options?.env !== undefined) {
        base.env = { ...options.env };
      }
      if (options?.cwd !== undefined) {
        base.cwd = options.cwd;
      }
      return base;
    })();
    recorded.push(invocation);

    const line = commandLine(command, args);
    const idx = queue.findIndex((q) => patternMatches(q.pattern, line));
    if (idx === -1) {
      return Promise.reject(new Error(`no mock response for: ${line}`));
    }
    const [entry] = queue.splice(idx, 1);
    // Defensive: TS narrowing for `noUncheckedIndexedAccess`.
    if (entry === undefined) {
      return Promise.reject(new Error(`no mock response for: ${line}`));
    }
    return Promise.resolve(materializeResponse(entry.response));
  };

  return {
    enqueue(commandPattern, response) {
      queue.push({ pattern: commandPattern, response });
    },
    invocations(): readonly MockShellInvocation[] {
      return [...recorded];
    },
    expectCommands(expected: readonly string[]): void {
      const actual = recorded.map((inv) => commandLine(inv.command, inv.args));
      expect(actual).toEqual([...expected]);
    },
    reset(): void {
      queue.length = 0;
      recorded.length = 0;
    },
    runner,
  };
}
