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
    neverBundle: [
      // optional, dynamically imported SDKs — resolved from node_modules at
      // runtime; never dragged into the bundle
      "z-ai-web-dev-sdk",
      /^@modelcontextprotocol\//,
    ],
  },
  outExtensions: () => ({ js: ".js" }),
});
