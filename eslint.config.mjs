import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import obsidianmd from "eslint-plugin-obsidianmd";

export default [
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        project: "./tsconfig.eslint.json",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
      "no-console": "off",
      "semi": ["error", "always"],
      // setDestructive() requires Obsidian 1.13.0 (unreleased); setWarning() is the only available API
      "@typescript-eslint/no-deprecated": "off",
      // false positives on form placeholders (URLs, API key hints, model IDs)
      "obsidianmd/ui/sentence-case": "off",
    },
  },
  {
    files: ["src/**/*.test.ts", "src/test-utils/**/*.ts", "src/**/__mocks__/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/unbound-method": "off",
      "obsidianmd/no-global-this": "off",
      "obsidianmd/no-nodejs-modules": "off",
    },
  },
  {
    ignores: ["node_modules/", "dist/", "main.js", "*.config.*", "src/benchmark/**"],
  },
];
