import { describe, expect, it } from 'vitest';

import { g, shouldUseUnicode } from '../../src/ui/glyphs.js';

describe('glyphs.g', () => {
  it('returns Unicode glyphs when ascii=false', () => {
    expect(g('check', false)).toBe('\u2713');
    expect(g('cross', false)).toBe('\u2717');
    expect(g('arrow', false)).toBe('\u2192');
    expect(g('recycle', false)).toBe('\u21bb');
    expect(g('warn', false)).toBe('\u26a0');
    expect(g('bullet', false)).toBe('\u2022');
    expect(g('dot', false)).toBe('.');
  });

  it('returns ASCII fallbacks when ascii=true', () => {
    expect(g('check', true)).toBe('OK');
    expect(g('cross', true)).toBe('X');
    expect(g('arrow', true)).toBe('>');
    expect(g('recycle', true)).toBe('~');
    expect(g('warn', true)).toBe('!');
    expect(g('bullet', true)).toBe('-');
    expect(g('dot', true)).toBe('.');
  });
});

describe('shouldUseUnicode', () => {
  it('returns true for TTY + en_US.UTF-8', () => {
    expect(shouldUseUnicode({ isTTY: true, lang: 'en_US.UTF-8' })).toBe(true);
  });

  it('returns true for TTY + utf8 variant casing', () => {
    expect(shouldUseUnicode({ isTTY: true, lang: 'C.utf8' })).toBe(true);
  });

  it('returns false for non-TTY (pipe/redirect)', () => {
    expect(shouldUseUnicode({ isTTY: false, lang: 'en_US.UTF-8' })).toBe(false);
  });

  it('returns false for TTY + empty LANG', () => {
    expect(shouldUseUnicode({ isTTY: true, lang: '' })).toBe(false);
  });

  it('returns false for TTY + undefined LANG', () => {
    expect(shouldUseUnicode({ isTTY: true, lang: undefined })).toBe(false);
  });

  it('returns false for TTY + plain C locale', () => {
    expect(shouldUseUnicode({ isTTY: true, lang: 'C' })).toBe(false);
  });

  it('returns false for TTY + POSIX locale', () => {
    expect(shouldUseUnicode({ isTTY: true, lang: 'POSIX' })).toBe(false);
  });
});
