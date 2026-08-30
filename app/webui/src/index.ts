#!/usr/bin/env node
/**
 * Tau WebUI entry — the `tau-web` binary and the `tau web` command bridge.
 * Exposes startWebUi/createRequestListener for programmatic use and the
 * commander hook so `tau web` launches the local web interface.
 *
 * (Line 1 is the #!/usr/bin/env node shebang; tsdown preserves it in the
 * bundle and marks the output executable.)
 */

import { pathToFileURL } from "node:url";
import type { Command } from "commander";
import { startWebUi } from "./server.js";

export { createRequestListener, startWebUi } from "./server.js";
export type { RunningWebUi, StartWebUiOptions } from "./server.js";

const DEFAULT_PORT = 8787;

/** Register `tau web` so the CLI can launch the web UI. */
export function registerWebCommand(program: Command): void {
  program
    .command("web")
    .description("Serve the Tau web UI on localhost")
    .option("-p, --port <number>", "port to listen on", String(DEFAULT_PORT))
    .action(async (options: { port: string }) => {
      const port = Number(options.port);
      if (!Number.isInteger(port) || port <= 0 || port > 65535) {
        console.error(`invalid port: ${options.port}`);
        process.exitCode = 1;
        return;
      }
      const { url } = await startWebUi({ port });
      console.log(`Tau web UI -> ${url}  (Ctrl+C to stop)`);
    });
}

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
