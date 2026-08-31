import fs from "node:fs";
import { defineConfig, type Plugin } from "vite";

/**
 * Vite config for the WebUI SERVER (node bundle, like the TUI's build):
 * `vite build -c vite.server.config.ts` bundles `src/index.ts` (the `tau-web`
 * bin) to `dist/index.js` with workspace `@tau/*` siblings and node builtins
 * external. `emptyOutDir: false` keeps `dist/client/` from the client build.
 */

/** Re-add the node shebang if bundling stripped it; keep the bin executable. */
function tauBinShebang(): Plugin {
  return {
    name: "tau-bin-shebang",
    renderChunk(code) {
      if (code.startsWith("#!")) return null;
      return "#!/usr/bin/env node\n" + code;
    },
    closeBundle() {
      const out = new URL("./dist/index.js", import.meta.url);
      fs.chmodSync(fs.realpathSync(out), 0o755);
    },
  };
}

export default defineConfig({
  build: {
    ssr: "src/index.ts",
    outDir: "dist",
    emptyOutDir: false,
    target: "node20",
    minify: false,
    sourcemap: true,
    rollupOptions: {
      output: { entryFileNames: "index.js" },
      external: [/^node:/, /^@tau\//],
    },
  },
  plugins: [tauBinShebang()],
});
