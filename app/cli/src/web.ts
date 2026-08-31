/**
 * `tau web` command — moved from @tau/webui so the WebUI package stays
 * 100% commander-free: only the CLI knows commander; @tau/webui exports
 * the plain startWebUi/createRequestListener API this wiring consumes.
 */
import type { Command } from "commander";
import { startWebUi } from "@tau/webui";

/** Register `tau web` so the CLI can launch the local web interface. */
export function registerWebCommand(program: Command): void {
  program
    .command("web")
    .description("Serve the Tau web UI on localhost")
    .option("-p, --port <number>", "port to listen on", "8787")
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
