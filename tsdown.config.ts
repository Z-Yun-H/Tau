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
    neverBundle: ["z-ai-web-dev-sdk"],
  },
  outExtensions: () => ({ js: ".js" }),
});
