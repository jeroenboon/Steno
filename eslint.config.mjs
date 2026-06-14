import tseslint from 'typescript-eslint'
import reactPlugin from 'eslint-plugin-react'
import reactHooksPlugin from 'eslint-plugin-react-hooks'
import importPlugin from 'eslint-plugin-import'
import prettierConfig from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: ['out/**', 'dist/**', 'node_modules/**'],
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
        version: 'detect',
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
