// D3: Tiny readline wrappers shared by interactive screens (consent, admin
// gate). Kept separate from sink.ts so screens can be tested independently
// of the full sink composition.

import { createInterface } from 'node:readline';

export interface PromptDeps {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
}

/** Read a single line from stdin, then close the interface so the host
 *  process can exit normally. Returns the line WITHOUT trailing newline. */
export function readLine(deps: PromptDeps): Promise<string> {
  return new Promise<string>((resolve) => {
    const rl = createInterface({
      input: deps.stdin,
      output: deps.stdout,
      terminal: false,
    });
    let resolved = false;
    const finish = (line: string): void => {
      if (resolved) return;
      resolved = true;
      try {
        rl.close();
      } catch {
        // best-effort
      }
      resolve(line);
    };
    rl.once('line', (line) => finish(line));
    rl.once('close', () => finish(''));
  });
}
