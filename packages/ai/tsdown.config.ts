import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  minify: false,
  sourcemap: true,
  dts: false,
  deps: {
    // optional, dynamically imported SDKs — resolved from node_modules at
    // runtime; never dragged into the bundle
    neverBundle: ["^@deepseek-ai\\/"],
  },
  outExtensions: () => ({ js: ".js" }),
});
