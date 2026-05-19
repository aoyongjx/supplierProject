import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  {
    linterOptions: {
      reportUnusedDisableDirectives: false,
    },
  },
  globalIgnores([
    'dist/**',
    'tmp/**',
    'tmp_*.js',
    'tmp_*.mjs',
    'runlogs/**',
    '.runlogs/**',
    '.run-logs/**',
    '.codex-runlogs/**',
    'logs/**',
    'crawl_exports/**',
    'server/index.recovered.js',
  ]),
  {
    files: ['src/**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-empty': 'off',
      'react-hooks/exhaustive-deps': 'off',
    },
  },
  {
    files: ['server/**/*.js', 'scripts/**/*.js', 'scripts/**/*.mjs', '*.js', '*.mjs'],
    ignores: ['src/**'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      'no-unused-vars': 'off',
      'no-empty': 'off',
      'no-useless-escape': 'off',
      'no-control-regex': 'off',
      'no-undef': 'off',
      'no-extra-boolean-cast': 'off',
    },
  },
])
