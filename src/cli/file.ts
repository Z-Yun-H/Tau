import type { Command } from "commander";
import { runToolDirect } from "./util.js";

export function registerFileCommands(program: Command): void {
  const file = program
    .command("file")
    .description("Filesystem tools: find, stat, tree, batch rename (dry-run by default)");

  file
    .command("find")
    .description("Recursively find files/directories by glob pattern")
    .argument("<pattern>", "glob like *.ts or **/*test*")
    .option("-p, --path <path>", "root path", ".")
    .option("-t, --type <type>", "any | file | dir", "any")
    .option("-l, --limit <n>", "max results", "200")
    .action(async (pattern: string, opts, command) => {
      await runToolDirect(
        "file.find",
        { pattern, path: opts.path, type: opts.type, limit: Number(opts.limit) },
        `file find ${pattern}`,
      );
      void command;
    });

  file
    .command("stat")
    .description("Show size/type/mtime of a file or directory")
    .argument("<path>", "target path")
    .action(async (path: string) => {
      await runToolDirect("file.stat", { path }, `file stat ${path}`);
    });

  file
    .command("tree")
    .description("Print a directory tree")
    .argument("[path]", "root path", ".")
    .option("-d, --depth <n>", "max depth (max 6)", "2")
    .action(async (path: string, opts) => {
      await runToolDirect("file.tree", { path, depth: Number(opts.depth) }, `file tree ${path}`);
    });

  file
    .command("rename")
    .description("Batch rename by regex — DRY RUN by default, add --execute to apply")
    .argument("<find>", "regex to match in filenames")
    .argument("<replace>", "replacement")
    .option("-p, --path <path>", "directory", ".")
    .option("-e, --execute", "actually apply renames", false)
    .action(async (find: string, replace: string, opts) => {
      await runToolDirect(
        "file.rename",
        { find, replace, path: opts.path, execute: opts.execute === true },
        `file rename ${find} -> ${replace}${opts.execute ? " (execute)" : " (dry-run)"}`,
      );
    });
}
