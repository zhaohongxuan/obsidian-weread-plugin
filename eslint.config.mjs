import { defineConfig, globalIgnores } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';
import depend from 'eslint-plugin-depend';
import tseslint from 'typescript-eslint';

// Official Obsidian community-plugin review lint.
//
// This mirrors what https://community.obsidian.md uses to scan a plugin release:
// the full `eslint-plugin-obsidianmd` `recommended` set (which itself bundles
// typescript-eslint type-checked rules, @microsoft/eslint-plugin-sdl,
// no-unsanitized, import and depend), minus only the rules the scanner
// explicitly disables. Run it with `npm run lint` to reproduce the scorecard's
// publicly-visible errors and warnings before submitting a release.
//
// See: https://github.com/gapmiss/obsidian-plugin-skill — reference/community-scanner.md
export default defineConfig([
    // Same exclusions the scanner applies: build output, tests, scripts, docs.
    globalIgnores([
        'node_modules',
        'dist',
        'build',
        'main.js',
        'coverage',
        'tests',
        'scripts',
        'docs',
        'cr_result'
    ]),
    ...obsidianmd.configs.recommended,
    {
        languageOptions: {
            parserOptions: {
                projectService: {
                    allowDefaultProject: ['eslint.config.*', 'webpack.config.js', 'version-bump.mjs']
                }
            }
        },
        rules: {
            // Rules the community scanner disables (or that are not applicable
            // outside its own harness). Everything else stays at the
            // `recommended` severity so local results match the scorecard.
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-argument': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-return': 'off',
            '@typescript-eslint/restrict-template-expressions': 'off',
            '@typescript-eslint/no-base-to-string': 'off',
            'obsidianmd/validate-manifest': 'off',
            'obsidianmd/validate-license': 'off',
            'obsidianmd/commands/no-command-in-command-id': 'off',
            'obsidianmd/commands/no-plugin-id-in-command-id': 'off'
        }
    },
    {
        // Rules the community scanner promotes/enables for newer submissions,
        // enforced here so `npm run lint` reflects the strict scorecard layer.
        files: ['**/*.ts'],
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                projectService: { allowDefaultProject: ['eslint.config.*', 'webpack.config.js', 'version-bump.mjs'] }
            }
        },
        plugins: { '@typescript-eslint': tseslint.plugin },
        rules: {
            '@typescript-eslint/restrict-plus-operands': 'error',
            '@typescript-eslint/no-unnecessary-type-assertion': 'error',
            '@typescript-eslint/only-throw-error': 'error',
            '@typescript-eslint/no-require-imports': 'error',
            '@typescript-eslint/no-misused-promises': 'off',
            'obsidianmd/no-unsupported-api': 'error',
            'obsidianmd/prefer-create-el': 'error',
            'obsidianmd/no-static-styles-assignment': 'error',
            'obsidianmd/prefer-file-manager-trash-file': 'error',
            'obsidianmd/no-misused-promises': 'error',
            'no-alert': 'error'
        }
    },
    {
        // crypto-js provides MD5/AES that neither WebCrypto nor Node crypto
        // cover inside Obsidian's renderer; replacing it would risk breaking
        // CookieCloud AES decryption and stable ID hashing, so allow it explicitly.
        files: ['package.json'],
        plugins: { depend },
        rules: {
            'depend/ban-dependencies': ['error', { allowed: ['crypto-js'] }]
        }
    }
]);
