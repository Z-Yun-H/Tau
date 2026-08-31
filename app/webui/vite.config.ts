import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import UnoCSS from "unocss/vite";
import { defineConfig } from "vite";

/**
 * Vite config for the WebUI CLIENT (Vue 3 + UnoCSS).
 *
 * - `vite build` → `dist/client/` (what the node server serves statically)
 * - `vite dev` → dev server on :5173 proxying `/api/*` to the local engine
 *   server (`pnpm dev:web` / `pnpm --filter @tau/webui dev:server`, :8787)
 *
 * The node server itself builds with `vite.server.config.ts`.
 */
export default defineConfig({
  root: fileURLToPath(new URL("./client", import.meta.url)),
  plugins: [vue(), UnoCSS()],
  build: {
    outDir: fileURLToPath(new URL("./dist/client", import.meta.url)),
    emptyOutDir: true,
    target: "es2022",
    sourcemap: true,
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
});
