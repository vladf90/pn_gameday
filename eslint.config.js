import path from 'node:path'
import { fileURLToPath } from 'node:url'
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig([
  globalIgnores(['**/build', '**/dist', '**/node_modules']),
  {
    files: ['frontend/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        tsconfigRootDir: path.join(rootDir, 'frontend'),
      },
    },
  },
  {
    files: ['backend/**/*.ts'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: path.join(rootDir, 'backend'),
      },
    },
    rules: {
      'no-console': 'error',
      '@typescript-eslint/no-unused-vars': ['warn', {
        varsIgnorePattern: '^(Entity|Column|PrimaryGeneratedColumn|ManyToOne|OneToMany|JoinColumn|CreateDateColumn|UpdateDateColumn|ManyToMany|OneToOne|JoinTable)$',
        argsIgnorePattern: '^_',
      }],
    },
  },
])
