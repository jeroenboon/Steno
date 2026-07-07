import tseslint from 'typescript-eslint'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'
import importPlugin from 'eslint-plugin-import'
import prettierConfig from 'eslint-config-prettier'

export default tseslint.config(
  {
    // src/renderer/src/preview.tsx is a local-only, gitignored preview harness
    // (not part of the build); keep it out of the type-aware lint project.
    ignores: ['out/**', 'dist/**', 'node_modules/**', 'src/renderer/src/preview.tsx'],
  },
  {
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        // Each file is matched to the project that includes it
        project: ['./tsconfig.node.json', './tsconfig.web.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      import: importPlugin,
    },
    settings: {
      react: {
        // Pin the React version instead of 'detect'. eslint-plugin-react@7.37.5
        // (latest; no eslint 10 release exists) detects the version via the
        // removed ESLint 10 context.getFilename(), which throws. An explicit
        // version skips detection entirely. Keep in sync with the react dep.
        version: '19.2',
      },
      'import/resolver': {
        typescript: {
          project: ['./tsconfig.node.json', './tsconfig.web.json'],
        },
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',

      ...reactPlugin.configs.recommended.rules,
      ...reactPlugin.configs['jsx-runtime'].rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      'import/order': [
        'warn',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      'import/no-duplicates': 'error',
    },
  },
  prettierConfig,
)
