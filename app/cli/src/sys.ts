/**
 * tau sys — direct access to the system tools (disk/info/proc) without going
 * through the AI.
 */

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

  sys
    .command("datetime")
    .description("Current date/time: local, ISO, epoch ms, timezone")
    .action(async () => {
      await runToolDirect("sys.datetime", {}, "sys datetime");
    });

  sys
    .command("which")
    .description("Resolve a bare command name via PATH (read-only)")
    .argument("<command>", "bare command name")
    .action(async (command: string) => {
      await runToolDirect("sys.which", { command }, `sys which ${command}`);
    });

  sys
    .command("env")
    .description("Read one environment variable by exact NAME (may hold secrets)")
    .argument("<name>", "variable name")
    .action(async (name: string) => {
      await runToolDirect("sys.env", { name }, `sys env ${name}`);
    });
}
