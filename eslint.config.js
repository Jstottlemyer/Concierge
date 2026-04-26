import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

export default [
  {
    ignores: [
      'dist/**',
      'build/**',
      'node_modules/**',
      '.mcpb-staging/**',
      'coverage/**',
      'packages/*/dist/**',
      'packages/*/build/**',
      'packages/*/node_modules/**',
      'packages/*/.mcpb-staging/**',
      'packages/*/coverage/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['packages/*/src/**/*.ts', 'packages/*/tests/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        // Use the per-package tsconfig.json — projectService resolves it from
        // the file being linted, so each package's strictness settings apply.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        NodeJS: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        // Built-in WHATWG fetch + AbortController are stable in Node ≥20.
        fetch: 'readonly',
        AbortController: 'readonly',
        // tsup `define` replacements — see build-defines.d.ts.
        __CONCIERGE_VENDOR_VERSION__: 'readonly',
        __CONCIERGE_SETUP_VERSION__: 'readonly',
        __CONCIERGE_CORE_VERSION__: 'readonly',
        __CONCIERGE_BUILD_TIME__: 'readonly',
        __CONCIERGE_BUILD_ID__: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'off',
    },
  },
  // B6: enforce read-only boundary in src/io/readonly.ts. This module is the
  // ONLY place ~/.config/gws/client_secret.json, ~/.claude.json, and the
  // ~/Library/Application Support/Claude/ tree may be touched, and it must
  // never write. Any import of a write/mutate operation from `fs` /
  // `node:fs` / `fs/promises` / `node:fs/promises` here fails lint.
  {
    files: ['packages/*/src/io/readonly.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "ImportDeclaration[source.value=/^(node:)?fs(\\/promises)?$/] ImportSpecifier[imported.name=/^(writeFile|writeFileSync|appendFile|appendFileSync|mkdir|mkdirSync|rm|rmSync|rmdir|rmdirSync|unlink|unlinkSync|rename|renameSync|truncate|truncateSync|copyFile|copyFileSync|chmod|chmodSync|chown|chownSync|symlink|symlinkSync|link|linkSync|utimes|utimesSync|open|openSync|createWriteStream)$/]",
          message:
            'src/io/readonly.ts must not import write/mutate operations from fs. This module is the read-only boundary for files owned by other tools (gws, claude CLI, Claude Desktop).',
        },
      ],
    },
  },
];
