// D3: Glyph table + ASCII fallback resolver.
//
// Two surfaces:
//   - `g(name, ascii)`: returns the Unicode or ASCII glyph for `name`.
//   - `shouldUseUnicode({isTTY, lang})`: heuristic D5 uses to decide the
//     `ascii` flag at TerminalUI construction time. Pure function so tests
//     can drive it with a truth table.

export type GlyphName =
  | 'check'
  | 'cross'
  | 'arrow'
  | 'recycle'
  | 'warn'
  | 'bullet'
  | 'dot';

interface GlyphPair {
  unicode: string;
  ascii: string;
}

const GLYPHS: Readonly<Record<GlyphName, GlyphPair>> = {
  check: { unicode: '\u2713', ascii: 'OK' },
  cross: { unicode: '\u2717', ascii: 'X' },
  arrow: { unicode: '\u2192', ascii: '>' },
  recycle: { unicode: '\u21bb', ascii: '~' },
  warn: { unicode: '\u26a0', ascii: '!' },
  bullet: { unicode: '\u2022', ascii: '-' },
  // The heartbeat dot is the same in both modes; keep it here so callers
  // never need to special-case the symbol set.
  dot: { unicode: '.', ascii: '.' },
};

/** Resolve a glyph by name. `ascii=true` returns the ASCII fallback. */
export function g(name: GlyphName, ascii: boolean): string {
  const pair = GLYPHS[name];
  return ascii ? pair.ascii : pair.unicode;
}

export interface ShouldUseUnicodeOpts {
  isTTY: boolean;
  lang: string | undefined;
}

/** Returns true if the terminal can safely render Unicode glyphs.
 *
 *  Used by D5 (cli wiring) to decide the `ascii` flag at TerminalUI
 *  construction time. Conservative: anything ambiguous → ASCII. */
export function shouldUseUnicode(opts: ShouldUseUnicodeOpts): boolean {
  if (!opts.isTTY) return false; // pipe / redirect → ASCII
  const lang = (opts.lang ?? '').toLowerCase();
  if (lang === '') return false; // unknown locale → ASCII (safe default)
  return lang.includes('utf-8') || lang.includes('utf8');
}
