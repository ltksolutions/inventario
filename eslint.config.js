// SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
// SPDX-License-Identifier: EUPL-1.2

// eslint.config.js — Flat config (ESLint 9+)
// https://eslint.org/docs/latest/use/configure/configuration-files

import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import prettierConfig from 'eslint-config-prettier';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';

export default [
  // Base JS recommended
  js.configs.recommended,

  // Global ignores
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/*.generated.*',
      '**/generated/**',
    ],
  },

  // TypeScript files
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        // No project/projectService — we don't use type-aware rules.
        // TS itself runs in `pnpm typecheck` step. ESLint stays fast and
        // covers all .ts files (including scripts/, tests/, configs)
        // without needing per-package tsconfig.eslint.json.
      },
      globals: {
        ...globals.node,
        ...globals.browser, // mostly safe; web code can override per-file if needed
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      import: importPlugin,
    },
    rules: {
      // TypeScript
      'no-redeclare': 'off', // TS handles this; allows const X + type X pattern
      'no-unused-vars': 'off', // Disabled in favor of @typescript-eslint/no-unused-vars
      // which understands parameter properties (public readonly), type
      // signatures, and other TS-specific patterns.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',

      // Imports
      'import/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index', 'type'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import/no-duplicates': 'error',

      // General
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'no-debugger': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  // JavaScript files (relaxed)
  {
    files: ['**/*.{js,mjs,cjs,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  },

  // Disable rules that conflict with Prettier (must be last)
  prettierConfig,
];
