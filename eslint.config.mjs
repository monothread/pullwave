import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
    { ignores: ['out/', 'dist/', 'node_modules/', 'docs/', 'scripts/fetch-binaries.mjs', 'scripts/screenshots/fixtures/', 'test-results/', 'test/e2e/fixtures/'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['**/*.{ts,tsx}'],
        languageOptions: { globals: { ...globals.node, ...globals.browser } },
        plugins: { 'react-hooks': reactHooks },
        rules: {
            ...reactHooks.configs.recommended.rules,
            '@typescript-eslint/no-explicit-any': 'error',
            curly: ['error', 'all'],
            'arrow-body-style': ['error', 'always']
        }
    }
);
