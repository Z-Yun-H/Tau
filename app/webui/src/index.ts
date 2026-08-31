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
import { startWebUi } from "./server.js";

export { createRequestListener, startWebUi } from "./server.js";
export type { RunningWebUi, StartWebUiOptions } from "./server.js";

const DEFAULT_PORT = 8787;

// Only auto-run when executed directly as the tau-web binary.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

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
