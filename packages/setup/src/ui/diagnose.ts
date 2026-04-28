// D3: Diagnose screen — pass-through writer.
//
// `concierge-setup --diagnose` formats its own text/JSON bundle elsewhere;
// the UI sink just emits it verbatim so users (and support tooling) can
// pipe the output without any UI sugar interleaved.

export interface DiagnoseDeps {
  stdout: NodeJS.WritableStream;
}

export function writeDiagnose(deps: DiagnoseDeps, text: string): void {
  deps.stdout.write(text);
  if (!text.endsWith('\n')) deps.stdout.write('\n');
}
