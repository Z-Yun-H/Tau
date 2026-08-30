import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Root Vitest config for the pnpm workspace — one test runner for the whole
 * monorepo. Workspace packages resolve to their TypeScript sources via the
 * alias map below, so tests always run against source, never stale dist.
 */
const pkg = (name: string): string =>
  fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

const workspaceAlias = ["core", "tools", "ui", "engine", "ai", "skills", "plugins", "agent"].map(
  (name) => ({ find: new RegExp(`^@tau/${name}$`), replacement: pkg(name) }),
);

export default defineConfig({
  resolve: { alias: workspaceAlias },
  test: {
    include: ["packages/*/tests/**/*.test.ts", "app/*/tests/**/*.test.ts"],
    environment: "node",
    globals: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["packages/*/src/**/*.ts", "app/*/src/**/*.ts"],
      exclude: [
        "app/cli/src/index.ts",
        "app/tui/src/index.ts",
        "app/webui/src/index.ts",
        "packages/ai/src/providers/zai.ts",
        "**/dist/**",
      ],
      thresholds: {
        statements: 55,
        branches: 55,
        functions: 55,
        lines: 55,
      },
    },
  },
});
