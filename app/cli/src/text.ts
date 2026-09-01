/**
 * tau text — direct access to the text tools (count/search/replace) without
 * going through the AI; replace stays dry-run-first like its tool counterpart.
 */

import type { Command } from "commander";
import { runToolDirect } from "./util.js";

export function registerTextCommands(program: Command): void {
  const text = program
    .command("text")
    .description("Text tools: search, replace (dry-run by default), count");

  text
    .command("search")
    .description("Grep-like regex search across files")
    .argument("<pattern>", "regex")
    .option("-g, --glob <glob>", "filename glob", "*")
    .option("-p, --path <path>", "root path", ".")
    .option("-i, --ignore-case", "case-insensitive", false)
    .option("-l, --limit <n>", "max hits", "100")
    .action(async (pattern: string, opts) => {
      await runToolDirect(
        "text.search",
        {
          pattern,
          glob: opts.glob,
          path: opts.path,
          ignoreCase: opts.ignoreCase === true,
          limit: Number(opts.limit),
        },
        `text search ${pattern}`,
      );
    });

  text
    .command("replace")
    .description("Regex replace across files — DRY RUN by default, add --execute to apply")
    .argument("<find>", "regex to find")
    .argument("<replace>", "replacement")
    .option("-g, --glob <glob>", "filename glob", "*")
    .option("-p, --path <path>", "root path", ".")
    .option("-e, --execute", "actually write changes", false)
    .action(async (find: string, replace: string, opts) => {
      await runToolDirect(
        "text.replace",
        {
          find,
          replace,
          glob: opts.glob,
          path: opts.path,
          execute: opts.execute === true,
        },
        `text replace ${find} -> ${replace}${opts.execute ? " (execute)" : " (dry-run)"}`,
      );
    });

  text
    .command("count")
    .description("Count lines/words/chars of a file or directory")
    .argument("[path]", "target", ".")
    .option("-g, --glob <glob>", "filename glob when target is a directory", "*")
    .action(async (path: string, opts) => {
      await runToolDirect("text.count", { path, glob: opts.glob }, `text count ${path}`);
    });

  text
    .command("hash")
    .description("sha256/sha1 digest of a file or a literal string")
    .option("-p, --path <path>", "file to hash")
    .option("-t, --text <text>", "string to hash")
    .option("-a, --algorithm <algo>", "sha256 (default) or sha1", "sha256")
    .action(async (opts) => {
      await runToolDirect(
        "text.hash",
        { path: opts.path, text: opts.text, algorithm: opts.algorithm },
        `text hash ${opts.path ?? opts.text ?? ""}`,
      );
    });
}
