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
        // tsup `define` replacements — see build-defines.d.ts.
        __CONCIERGE_VENDOR_VERSION__: 'readonly',
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
];
