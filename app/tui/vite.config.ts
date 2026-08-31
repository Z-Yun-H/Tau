import fs from "node:fs";
import { defineConfig, type Plugin } from "vite";

/**
 * Vite build for the terminal app (node target).
 *
 * The TUI builds with vite like the WebUI, but in SSR/node mode: the entry
 * is bundled for Node 20 ESM, workspace `@tau/*` siblings stay external
 * (resolved from node_modules at runtime, exactly like the tsdown builds of
 * the other packages). `vite build --watch` is the dev loop; source runs via
 * `pnpm dev:tui` (tsx --conditions=development) are unaffected.
 *
 * The shebang on `src/index.ts` line 1 is what makes dist/index.js a valid
 * `bin` — vite does not guarantee it survives bundling, so the plugin below
 * re-adds it and marks the output executable.
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
    target: "node20",
    minify: false,
    sourcemap: true,
    emptyOutDir: true,
    rollupOptions: {
      output: { entryFileNames: "index.js" },
      external: [
        /^node:/,
        /^@tau\//,
        "commander", // type-only import; external in case it is ever value-imported
      ],
    },
  },
  plugins: [tauBinShebang()],
});
