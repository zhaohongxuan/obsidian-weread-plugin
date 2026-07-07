import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

export default [
  // Obsidian developer-guidelines recommended ruleset. Bundles security
  // plugins (no-unsanitized, @microsoft/sdl), eslint-plugin-depend, and
  // typescript-eslint type-aware rules. Below we keep only the
  // submission-blocker rules as errors and downgrade the rest.
  ...obsidianmd.configs.recommended,

  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'main.js',
      'webpack.config.js',
      'eslint.config.mjs',
      'scripts/**',
    ],
  },

  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.json',
        sourceType: 'module',
        ecmaVersion: 'latest',
      },
    },
    rules: {
      // ERRORS (submission blockers — security / compatibility / leaks):
      //   no-unsanitized/property, @microsoft/sdl/no-inner-html,
      //   obsidianmd/regex-lookbehind, no-forbidden-elements, detach-leaves,
      //   no-plugin-as-component, no-view-references-in-plugin, platform,
      //   no-nodejs-modules, ... stay 'error' from the recommended preset.

      // OFF — not enforced by the official review and conflict with project
      // conventions (AGENTS.md permits `any` and console.log)
      'obsidianmd/rule-custom-message': 'off', // no-console; AGENTS.md uses console.log
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',

      // WARN — legitimate issues but not submission-blockers; deferred
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn',
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
      '@typescript-eslint/no-require-imports': 'warn',
      '@typescript-eslint/only-throw-error': 'warn',
      '@typescript-eslint/no-unused-expressions': 'warn',
      'obsidianmd/no-unsupported-api': 'warn',
      'obsidianmd/no-static-styles-assignment': 'warn',
      'obsidianmd/settings-tab/no-manual-html-headings': 'warn',
      'depend/ban-dependencies': 'warn',

      // Project conventions (preserved from prior config)
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-explicit-any': 'off',
      'no-prototype-builtins': 'off',
      'no-empty-function': 'off',
      '@typescript-eslint/no-empty-function': 'off',
      'no-var-requires': 'off',
      '@typescript-eslint/no-var-requires': 'off',
    },
  },

  {
    // depend/ban-dependencies also lints package.json; crypto-js is flagged
    // as deprecated but is not a submission blocker. Keep it visible as a
    // warning rather than failing CI.
    files: ['**/package.json'],
    rules: {
      'depend/ban-dependencies': 'warn',
    },
  },
];
