import { Readable, Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import {
  parseConsentInput,
  showConsent,
} from '../../src/ui/consent.js';

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

function stdinFrom(line: string): NodeJS.ReadableStream {
  // readline.createInterface listens for data + 'line' events; pushing a
  // single chunk with a newline gets us one line then EOF.
  return Readable.from([line]);
}

describe('parseConsentInput', () => {
  it('accepts empty line', () => {
    expect(parseConsentInput('')).toEqual({ accepted: true });
  });
  it('accepts y', () => {
    expect(parseConsentInput('y')).toEqual({ accepted: true });
  });
  it('accepts Y', () => {
    expect(parseConsentInput('Y')).toEqual({ accepted: true });
  });
  it('accepts yes', () => {
    expect(parseConsentInput('yes')).toEqual({ accepted: true });
  });
  it('accepts YES with whitespace', () => {
    expect(parseConsentInput('  YES  ')).toEqual({ accepted: true });
  });
  it('rejects n', () => {
    expect(parseConsentInput('n')).toEqual({ accepted: false });
  });
  it('rejects N', () => {
    expect(parseConsentInput('N')).toEqual({ accepted: false });
  });
  it('rejects no', () => {
    expect(parseConsentInput('no')).toEqual({ accepted: false });
  });
  it('rejects garbage', () => {
    expect(parseConsentInput('asdf')).toEqual({ accepted: false });
  });
});

describe('showConsent (interactive)', () => {
  it('returns accepted=true when stdin sends Y', async () => {
    const { stream, output } = bufferStream();
    const result = await showConsent(
      { stdin: stdinFrom('Y\n'), stdout: stream, ascii: true },
      'BODY',
    );
    expect(result).toEqual({ accepted: true });
    expect(output()).toContain('BODY');
    expect(output()).toContain('Continue? [Y/n]');
  });

  it('returns accepted=true on empty input (default Y)', async () => {
    const { stream } = bufferStream();
    const result = await showConsent(
      { stdin: stdinFrom('\n'), stdout: stream, ascii: true },
      'BODY',
    );
    expect(result).toEqual({ accepted: true });
  });

  it('returns accepted=false when stdin sends n', async () => {
    const { stream, output } = bufferStream();
    const result = await showConsent(
      { stdin: stdinFrom('n\n'), stdout: stream, ascii: true },
      'BODY',
    );
    expect(result).toEqual({ accepted: false });
    expect(output()).toContain('Setup cancelled.');
  });
});
