import { defineConfig, globalIgnores } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

// Adopt Obsidian's official recommended config (eslint-plugin-obsidianmd 0.6+).
// This brings in the community-plugin review checks that previously slipped
// through locally: `obsidianmd/validate-manifest` (no unknown manifest fields)
// and the `no-unsanitized/property` / `@microsoft/sdl/no-inner-html` rules
// (no unsafe innerHTML assignment).
export default defineConfig([
    // Build output, bundled entry and standalone helper scripts are not plugin source.
    globalIgnores(['node_modules', 'dist', 'main.js', 'coverage', 'tests', 'cr_result']),
    ...obsidianmd.configs.recommended,
    {
        languageOptions: {
            parserOptions: {
                projectService: {
                    allowDefaultProject: [
                        'eslint.config.*',
                        'webpack.config.js',
                        'version-bump.mjs',
                        'scripts/*'
                    ]
                }
            }
        },
        rules: {
            // This codebase predates strict type-checked linting and models a lot
            // of loosely-typed WeRead API payloads as `any`. Keep the review-critical
            // security/manifest rules on (above) while relaxing the noisy,
            // idiomatic-style type-checked rules that would otherwise require a
            // broad, behaviour-affecting refactor of working sync code.
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-argument': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-return': 'off',
            '@typescript-eslint/restrict-plus-operands': 'off',
            // Explicit `any` is used deliberately for loosely-typed WeRead
            // payloads; keep it off (not fixToUnknown) so `--fix` never rewrites
            // working code into `unknown`.
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unnecessary-type-assertion': 'off',
            '@typescript-eslint/no-floating-promises': 'off',
            '@typescript-eslint/no-misused-promises': 'off',
            '@typescript-eslint/no-deprecated': 'off',
            '@typescript-eslint/only-throw-error': 'off',
            '@typescript-eslint/no-base-to-string': 'off',
            '@typescript-eslint/await-thenable': 'off',
            '@typescript-eslint/no-unused-expressions': 'off',
            '@typescript-eslint/no-require-imports': 'off',
            '@typescript-eslint/no-var-requires': 'off',
            // Deliberate debug logging is used for developer visibility.
            'no-console': 'off',
            'obsidianmd/rule-custom-message': 'off',
            // Styling via inline .style is used for dynamic layout and is not a
            // security concern; keep as a warning so it stays visible.
            'obsidianmd/no-static-styles-assignment': 'warn',
            'no-control-regex': 'off',
            'no-alert': 'off',
            'no-useless-escape': 'off',
            'no-restricted-globals': 'off',
            'depend/ban-dependencies': 'off',
            'obsidianmd/no-unsupported-api': 'warn',
            'obsidianmd/commands/no-command-in-command-id': 'off',
            'obsidianmd/no-tfile-tfolder-cast': 'off',
            'obsidianmd/settings-tab/no-manual-html-headings': 'off',
            'obsidianmd/prefer-create-el': 'off',
            'obsidianmd/prefer-window-timers': 'off',
            'obsidianmd/prefer-active-doc': 'off',
            'obsidianmd/prefer-instanceof': 'off'
        }
    }
]);
