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
      // ignoreRestSiblings: Obsidian 권장 설정(eslint-plugin-obsidianmd)과 동일 — rest 구조 분해로 필드를 제외하는 패턴 허용
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", ignoreRestSiblings: true }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
      "no-console": "off",
      "semi": ["error", "always"],
      // minAppVersion 1.7.2 호환: setDestructive()는 1.13+ 전용이므로 setWarning() 유지
      "@typescript-eslint/no-deprecated": "off",
      // URL·API키 placeholder·모델 ID 등 비문장 텍스트에서 오탐 다수 발생
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
