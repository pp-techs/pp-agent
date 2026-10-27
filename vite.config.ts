import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    printWidth: 100,
    ignorePatterns: [
      "**/dist/**",
      "**/release/**",
      "pnpm-lock.yaml",
      "apps/desktop/resources/skills/**",
      ".agents/**",
    ],
  },
  lint: {
    plugins: ["typescript"],
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ["**/dist/**", "**/release/**", ".agents/**"],
    overrides: [
      {
        files: ["apps/web/**", "packages/ui/**"],
        plugins: ["react"],
        env: { browser: true },
      },
      {
        files: ["apps/desktop/**"],
        env: { node: true },
      },
    ],
  },
  run: {
    cache: true,
  },
});
