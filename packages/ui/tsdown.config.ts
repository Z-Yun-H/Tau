import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  deps: {
    // optionalDependency — dynamically imported, resolved from node_modules
    // at runtime, graceful degradation when absent; never bundled
    neverBundle: ["^sharp$"],
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  minify: false,
  sourcemap: true,
  dts: false,
  outExtensions: () => ({ js: ".js" }),
});
