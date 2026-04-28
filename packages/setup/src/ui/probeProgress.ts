// D3: Per-probe scan progress lines.
//
// Orchestrator calls `showProbeProgress(name, status)` once per probe. We
// render each as a single line; the "Found from previous Concierge install"
// roll-up is rendered when the orchestrator finishes the probe loop and
// hands off to the consent screen — but to keep the screen self-contained
// and survive future reorderings, we emit each line as it arrives.

import { g } from './glyphs.js';

export interface ProbeProgressDeps {
  stdout: NodeJS.WritableStream;
  ascii: boolean;
}

export type ProbeUiStatus = 'pending' | 'ok' | 'missing' | 'broken';

/** Map a probe status to its glyph. `pending` renders as a bullet so the
 *  user sees the probe scrolled by but not as success/fail. */
function statusGlyph(status: ProbeUiStatus, ascii: boolean): string {
  switch (status) {
    case 'ok':
      return g('check', ascii);
    case 'missing':
      return g('cross', ascii);
    case 'broken':
      // No 'stale' bucket in the UISink contract; orchestrator maps stale →
      // broken. Both render with the warn glyph so the user sees a yellow
      // signal vs. the harder cross for outright missing.
      return g('warn', ascii);
    case 'pending':
      return g('bullet', ascii);
  }
}

export function renderProbeLine(
  name: string,
  status: ProbeUiStatus,
  ascii: boolean,
): string {
  return `  ${statusGlyph(status, ascii)} ${name}`;
}

export function writeProbeProgress(
  deps: ProbeProgressDeps,
  name: string,
  status: ProbeUiStatus,
): void {
  deps.stdout.write(renderProbeLine(name, status, deps.ascii) + '\n');
}
