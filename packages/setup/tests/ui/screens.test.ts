import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { renderBanner } from '../../src/ui/banner.js';
import {
  renderInstallLine,
  writeInstallProgress,
} from '../../src/ui/installProgress.js';
import {
  renderProbeLine,
  writeProbeProgress,
} from '../../src/ui/probeProgress.js';
import { renderSuccess } from '../../src/ui/success.js';
import { renderFailure } from '../../src/ui/failure.js';
import { renderLockCollision } from '../../src/ui/lockCollision.js';
import { writeDiagnose } from '../../src/ui/diagnose.js';

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

describe('banner', () => {
  it('contains the title and tagline', () => {
    const out = renderBanner(false);
    expect(out).toContain('Concierge Setup v');
    expect(out).toContain('Google Workspace write-access for Claude Desktop');
  });
});

describe('probeProgress', () => {
  it('renders ok status with check glyph (Unicode)', () => {
    expect(renderProbeLine('homebrew', 'ok', false)).toContain('\u2713');
    expect(renderProbeLine('homebrew', 'ok', false)).toContain('homebrew');
  });

  it('renders ok status with OK glyph (ASCII)', () => {
    expect(renderProbeLine('homebrew', 'ok', true)).toContain('OK');
  });

  it('renders missing status with cross glyph', () => {
    expect(renderProbeLine('gws', 'missing', true)).toContain('X');
  });

  it('renders broken/stale status with warn glyph', () => {
    expect(renderProbeLine('node', 'broken', true)).toContain('!');
  });

  it('renders pending status with bullet glyph', () => {
    expect(renderProbeLine('node', 'pending', true)).toContain('-');
  });

  it('writes a line terminated by newline', () => {
    const { stream, output } = bufferStream();
    writeProbeProgress({ stdout: stream, ascii: true }, 'homebrew', 'ok');
    expect(output().endsWith('\n')).toBe(true);
  });
});

describe('installProgress', () => {
  it('renders starting phase with arrow glyph', () => {
    expect(renderInstallLine('gws', 'starting', false)).toContain('\u2192');
    expect(renderInstallLine('gws', 'starting', false)).toContain(
      'Installing gws via brew',
    );
  });

  it('renders done phase with version detail', () => {
    const out = renderInstallLine('gws', 'done', true, '0.22.5');
    expect(out).toContain('OK');
    expect(out).toContain('gws 0.22.5 installed');
  });

  it('renders done phase without version', () => {
    const out = renderInstallLine('gws', 'done', true);
    expect(out).toContain('gws installed');
  });

  it('renders failed phase with cross glyph + detail', () => {
    const out = renderInstallLine('gws', 'failed', true, 'brew error');
    expect(out).toContain('X');
    expect(out).toContain('gws install failed');
    expect(out).toContain('brew error');
  });

  it('writes a single newline-terminated line', () => {
    const { stream, output } = bufferStream();
    writeInstallProgress(
      { stdout: stream, ascii: true },
      'gws',
      'starting',
    );
    expect(output().split('\n').length).toBe(2); // line + trailing
  });
});

describe('success', () => {
  it('renders success block with both targets passing', () => {
    const out = renderSuccess(
      { desktopOk: true, cliOk: true },
      false,
    );
    expect(out).toContain('Concierge installed and verified');
    expect(out).toContain('build_id:');
    expect(out).toContain('Claude Desktop:');
    expect(out).toContain('Claude CLI:');
    expect(out).toContain('Try `Use list_accounts`');
  });

  it('shows cross when a target failed', () => {
    const out = renderSuccess(
      { desktopOk: false, cliOk: true },
      true,
    );
    expect(out).toContain('Claude Desktop: X');
    expect(out).toContain('Claude CLI: OK');
  });

  it('appends detail line when provided', () => {
    const out = renderSuccess(
      { desktopOk: true, cliOk: true, detail: 'Recovered after retry.' },
      true,
    );
    expect(out).toContain('Recovered after retry.');
  });
});

describe('failure', () => {
  it('renders heading + message', () => {
    const out = renderFailure(
      { phase: 'install', message: 'gws install failed' },
      true,
    );
    expect(out).toContain('!');
    expect(out).toContain('install failed: gws install failed');
  });

  it('renders copyable command and log path when present', () => {
    const out = renderFailure(
      {
        phase: 'oauth.login',
        message: 'port collision',
        copyableCommand: 'lsof -i :8080',
        logPath: '/tmp/setup.log',
      },
      true,
    );
    expect(out).toContain('lsof -i :8080');
    expect(out).toContain('/tmp/setup.log');
  });
});

describe('lockCollision', () => {
  it('renders both lines with PID and start time', () => {
    const out = renderLockCollision(1234, '2026-04-28 09:15:32');
    expect(out).toContain('PID 1234');
    expect(out).toContain('2026-04-28 09:15:32');
    expect(out).toContain('Wait for it to finish or kill it');
  });
});

describe('diagnose', () => {
  it('passes through text verbatim', () => {
    const { stream, output } = bufferStream();
    writeDiagnose({ stdout: stream }, 'raw diagnose payload');
    expect(output()).toBe('raw diagnose payload\n');
  });

  it('does not double-newline already-terminated text', () => {
    const { stream, output } = bufferStream();
    writeDiagnose({ stdout: stream }, 'already\n');
    expect(output()).toBe('already\n');
  });
});
