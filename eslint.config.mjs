import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.next/**', '**/node_modules/**', '**/next-env.d.ts', '**/playwright-report/**', '**/test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Config files run in Node.
    files: ['**/*.mjs', '**/*.config.{js,ts}'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
);
