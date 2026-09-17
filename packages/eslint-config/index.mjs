import js from '@eslint/js';
import ts from 'typescript-eslint';
export default [
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/generated/**',
      '**/.cache/**',
      '**/node_modules/**',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  { rules: { '@typescript-eslint/no-explicit-any': 'error' } },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        document: 'readonly',
        window: 'readonly',
        AbortSignal: 'readonly',
      },
    },
  },
];
