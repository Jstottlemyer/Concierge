import { Readable, Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createTerminalUI } from '../../src/ui/sink.js';

function bufferStream(): {
  stream: NodeJS.WritableStream;
  output: () => string;
} {
  const chunks: string[] = [];
  const stream = new Writable({
    write(c, _e, cb): void {
      chunks.push(c.toString());
      cb();
    },
  });
  return { stream, output: () => chunks.join('') };
}

function nullStdin(): NodeJS.ReadableStream {
  return Readable.from([]);
}

describe('createTerminalUI', () => {
  it('banner writes to stdout (Unicode in non-ascii mode)', () => {
    const out = bufferStream();
    const err = bufferStream();
    const ui = createTerminalUI({
      stdout: out.stream,
      stderr: err.stream,
      stdin: nullStdin(),
      ascii: false,
    });
    ui.banner();
    expect(out.output()).toContain('Concierge Setup v');
    expect(err.output()).toBe('');
  });

  it('banner ASCII mode produces ASCII fallbacks elsewhere too', () => {
    const out = bufferStream();
    const err = bufferStream();
    const ui = createTerminalUI({
      stdout: out.stream,
      stderr: err.stream,
      stdin: nullStdin(),
      ascii: true,
    });
    ui.showProbeProgress('homebrew', 'ok');
    expect(out.output()).toContain('OK');
    expect(out.output()).not.toContain('\u2713');
  });

  it('non-ascii mode emits Unicode glyphs', () => {
    const out = bufferStream();
    const err = bufferStream();
    const ui = createTerminalUI({
      stdout: out.stream,
      stderr: err.stream,
      stdin: nullStdin(),
      ascii: false,
    });
    ui.showProbeProgress('homebrew', 'ok');
    expect(out.output()).toContain('\u2713');
  });

  it('showInstallProgress writes to stdout', () => {
    const out = bufferStream();
    const err = bufferStream();
    const ui = createTerminalUI({
      stdout: out.stream,
      stderr: err.stream,
      stdin: nullStdin(),
      ascii: true,
    });
    ui.showInstallProgress('gws', 'starting');
    ui.showInstallProgress('gws', 'done', '0.22.5');
    expect(out.output()).toContain('Installing gws via brew');
    expect(out.output()).toContain('gws 0.22.5 installed');
  });

  it('showFailure writes to stderr, not stdout', () => {
    const out = bufferStream();
    const err = bufferStream();
    const ui = createTerminalUI({
      stdout: out.stream,
      stderr: err.stream,
      stdin: nullStdin(),
      ascii: true,
    });
    ui.showFailure('install', 'gws install failed', 'brew install gws');
    expect(err.output()).toContain('install failed: gws install failed');
    expect(err.output()).toContain('brew install gws');
    expect(out.output()).toBe('');
  });

  it('showLockCollision writes to stderr', () => {
    const out = bufferStream();
    const err = bufferStream();
    const ui = createTerminalUI({
      stdout: out.stream,
      stderr: err.stream,
      stdin: nullStdin(),
      ascii: true,
    });
    ui.showLockCollision(1234, '2026-04-28 09:15:32');
    expect(err.output()).toContain('PID 1234');
    expect(out.output()).toBe('');
  });

  it('showSuccess writes the success block to stdout', () => {
    const out = bufferStream();
    const err = bufferStream();
    const ui = createTerminalUI({
      stdout: out.stream,
      stderr: err.stream,
      stdin: nullStdin(),
      ascii: true,
    });
    ui.showSuccess('Concierge is set up.');
    expect(out.output()).toContain('Concierge installed and verified');
    expect(out.output()).toContain('Concierge is set up.');
    expect(err.output()).toBe('');
  });

  it('showDiagnose passes text through to stdout verbatim', () => {
    const out = bufferStream();
    const err = bufferStream();
    const ui = createTerminalUI({
      stdout: out.stream,
      stderr: err.stream,
      stdin: nullStdin(),
      ascii: true,
    });
    ui.showDiagnose('diagnose payload\n');
    expect(out.output()).toBe('diagnose payload\n');
  });

  it('showOauthWait registers a heartbeat that subsequent calls clean up', () => {
    const out = bufferStream();
    const err = bufferStream();
    const ui = createTerminalUI({
      stdout: out.stream,
      stderr: err.stream,
      stdin: nullStdin(),
      ascii: true,
    });
    ui.showOauthWait('https://example.com/auth');
    expect(out.output()).toContain('Browser opened');
    expect(out.output()).toContain('https://example.com/auth');
    // Following call should stop the heartbeat without throwing.
    ui.showSuccess('done');
    expect(out.output()).toContain('Concierge installed and verified');
  });

  it('consent prompt accepts Y from stdin', async () => {
    const out = bufferStream();
    const err = bufferStream();
    const ui = createTerminalUI({
      stdout: out.stream,
      stderr: err.stream,
      stdin: Readable.from(['Y\n']),
      ascii: true,
    });
    const decision = await ui.showConsentScreen('CONSENT_BODY');
    expect(decision).toEqual({ accepted: true });
    expect(out.output()).toContain('CONSENT_BODY');
  });

  it('admin gate prints handout and resolves on stdin newline', async () => {
    const out = bufferStream();
    const err = bufferStream();
    const ui = createTerminalUI({
      stdout: out.stream,
      stderr: err.stream,
      stdin: Readable.from(['\n']),
      ascii: true,
    });
    await ui.showAdminGate('Admin instructions body.');
    expect(out.output()).toContain('Admin action required');
    expect(out.output()).toContain('Admin instructions body.');
    expect(out.output()).toContain('Press Enter to exit');
  });
});
