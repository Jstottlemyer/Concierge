// Ambient declarations for the tsup `define` replacements.
//
// At build time, tsup substitutes these string literals with JSON-stringified
// values read from package.json (setup) and ../core/package.json (core). In
// development (vitest), the substitution hasn't happened, so consumer code
// should provide a runtime fallback when `typeof __XXX__ === 'undefined'`.

declare const __CONCIERGE_SETUP_VERSION__: string;
declare const __CONCIERGE_CORE_VERSION__: string;
declare const __CONCIERGE_BUILD_TIME__: string;
declare const __CONCIERGE_BUILD_ID__: string;
