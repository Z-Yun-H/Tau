/**
 * tau file — direct access to the file tools (find/stat/tree/rename) without
 * going through the AI. Same ToolDefinition contracts, same safety semantics.
 */

import type { Command } from "commander";
import { theme } from "@tau/ui";
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
    .command("read")
    .description("Read a text file with line numbers (refuses binaries, 2MB cap)")
    .argument("<path>", "file path")
    .option("-o, --offset <n>", "1-based start line", "1")
    .option("-l, --limit <n>", "max lines (cap 2000)", "400")
    .action(async (path: string, opts) => {
      await runToolDirect(
        "file.read",
        { path, offset: Number(opts.offset), limit: Number(opts.limit) },
        `file read ${path}`,
      );
    });

  file
    .command("list")
    .description("List one directory (non-recursive): type, bytes, mtime, name")
    .argument("[path]", "directory", ".")
    .option("-l, --limit <n>", "max entries", "200")
    .option("-H, --include-hidden", "include dotfiles", false)
    .action(async (path: string, opts) => {
      await runToolDirect(
        "file.list",
        { path, limit: Number(opts.limit), includeHidden: opts.includeHidden === true },
        `file list ${path}`,
      );
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

  file
    .command("write")
    .description("Write a text file — DRY RUN by default, add --execute to apply")
    .argument("<path>", "target file path (workspace-relative)")
    .argument("[content...]", "file content; a single '-' reads stdin instead")
    .option("-m, --mode <mode>", "overwrite (default) | append", "overwrite")
    .option("-d, --create-dirs", "create missing parent directories", false)
    .option("-e, --execute", "actually write (default: dry-run preview)", false)
    .action(async (path: string, contentParts: string[], opts) => {
      let content = contentParts.join(" ");
      if (content === "-") {
        // Explicit stdin mode (`echo x | tau file write f.txt -`) — never an
        // implicit TTY probe, so in-process tests stay deterministic.
        content = await new Promise<string>((resolve, reject) => {
          let data = "";
          process.stdin.on("data", (chunk: Buffer) => (data += chunk.toString()));
          process.stdin.on("end", () => resolve(data));
          process.stdin.on("error", reject);
        });
      } else if (content.length === 0) {
        console.error(theme.error("file write: content is required (or pass '-' to read stdin)"));
        process.exitCode = 1;
        return;
      }
      await runToolDirect(
        "file.write",
        {
          path,
          content,
          mode: opts.mode,
          createDirs: opts.createDirs === true,
          execute: opts.execute === true,
        },
        `file write ${path}${opts.execute ? ` (${opts.mode}, execute)` : " (dry-run)"}`,
      );
    });
}
