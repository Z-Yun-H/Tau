import type { Command } from "commander";
import { runToolDirect } from "./util.js";

export function registerSysCommands(program: Command): void {
  const sys = program
    .command("sys")
    .description("System inspection tools: info, disk, processes (read-only)");

  sys
    .command("info")
    .description("OS, CPU, memory and uptime summary")
    .action(async () => {
      await runToolDirect("sys.info", {}, "sys info");
    });

  sys
    .command("disk")
    .description("Disk usage for a path")
    .argument("[path]", "path to inspect", ".")
    .action(async (path: string) => {
      await runToolDirect("sys.disk", { path }, `sys disk ${path}`);
    });

  sys
    .command("proc")
    .description("Top processes by CPU")
    .option("-l, --limit <n>", "rows to show", "15")
    .action(async (opts) => {
      await runToolDirect("sys.proc", { limit: Number(opts.limit) }, "sys proc");
    });
}
