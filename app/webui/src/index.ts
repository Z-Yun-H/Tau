#!/usr/bin/env node
/**
 * Tau WebUI entry — the `tau-web` binary.
 * Exposes startWebUi/createRequestListener for programmatic use. (The
 * `tau web` commander wiring lives in @tau/cli — this package stays
 * framework-free.)
 *
 * (Line 1 is the #!/usr/bin/env node shebang; the vite server build
 * re-adds it if bundling strips it, and marks the output executable.)
 */

import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { startWebUi } from "./server.js";

export { createRequestListener, startWebUi } from "./server.js";
export type { RunningWebUi, StartWebUiOptions } from "./server.js";
export { GoalRegistry, approvalTtlMs, DEFAULT_APPROVAL_TTL_MS } from "./goal.js";

const DEFAULT_PORT = 8787;

// Only auto-run when executed directly as the tau-web binary.
// Installed bins run through a symlink (npm/pnpm .bin, `pnpm link`), so
// argv[1] must be resolved to its realpath before comparing against
// import.meta.url (Node ESM reports this module under its real path).
const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  const argIndex = process.argv.indexOf("--port");
  const rawPort = argIndex !== -1 ? process.argv[argIndex + 1] : undefined;
  const port = rawPort !== undefined ? Number(rawPort) : DEFAULT_PORT;
  startWebUi({ port: Number.isInteger(port) ? port : DEFAULT_PORT })
    .then(({ url }) => {
      console.log(`Tau web UI -> ${url}  (Ctrl+C to stop)`);
    })
    .catch((error) => {
      console.error((error as Error).message);
      process.exitCode = 1;
    });
}
