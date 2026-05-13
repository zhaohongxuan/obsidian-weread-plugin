import tsParser from "@typescript-eslint/parser";
import obsidianmd from "eslint-plugin-obsidianmd";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "main.js"],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: "module",
        ecmaVersion: "latest",
      },
    },
    plugins: {
      obsidianmd,
    },
    rules: {
      // Obsidian recommended rules
      ...Object.keys(obsidianmd.rules || {}).reduce((acc, key) => {
        const meta = obsidianmd.rules[key]?.meta;
        if (meta?.docs?.recommended) {
          acc[`obsidianmd/${key}`] = meta.docs.recommended === "warn" ? "warn" : "error";
        }
        return acc;
      }, {}),
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-prototype-builtins": "off",
      "no-empty-function": "off",
      "no-explicit-any": "off",
      "no-var-requires": "off",
    },
  },
];
