import { defineConfig } from "tsdown";

/**
 * Unified workspace build — ONE tsdown process builds every workspace package
 * (tsdown "workspace mode", experimental): `pnpm build` at the repo root
 * replaces the former `pnpm -r build` fan-out while producing the exact same
 * per-package `dist/` output.
 *
 * Layering rules:
 * - this root config is the SHARED base for every package;
 * - each package's own `tsdown.config.ts` is still discovered and merged on
 *   top of it — the per-feature-area files are NOT affected: `@tau/ai`
 *   (neverBundle @deepseek-ai), `@tau/plugins` (neverBundle
 *   @modelcontextprotocol) and `@tau/webui` (extra `src/server.ts` entry)
 *   keep their package-specific options;
 * - `pnpm --filter <pkg> build` keeps building a single package from its own
 *   config, unchanged.
 */
export default defineConfig({
  workspace: ["packages/*", "app/*"],
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  minify: false,
  sourcemap: true,
  dts: false,
  outExtensions: () => ({ js: ".js" }),
});
