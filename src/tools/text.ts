/**
 * Text tools — text.count / text.search / text.replace over files.
 * replace is dry-run by default and requires an explicit confirm flag, and
 * search reuses the glob-to-regex translation from the file family.
 */

import fs from "node:fs";
import path from "node:path";
import type { ToolDefinition, ToolResult } from "../types.js";
import { boolArg, numArg, strArg, textResult } from "./registry.js";
import { globToRegex } from "./file.js";

/**
 * text.* — searching and controlled text mutation inside files.
 * replace is dry-run by default and never touches .git/, node_modules/, binaries.
 */

const SKIP_DIRS = new Set([".git", "node_modules", "dist", ".tau", "coverage"]);

function collectFiles(root: string, glob: string, limit: number): string[] {
  const regex = globToRegex(glob);
  const out: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (out.length >= limit || depth > 10) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= limit) return;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), depth + 1);
        continue;
      }
      if (entry.isFile() && regex.test(entry.name)) out.push(path.join(dir, entry.name));
    }
  };
  if (fs.statSync(root).isFile()) return [root];
  walk(root, 0);
  return out;
}

function isProbablyBinary(buffer: Buffer): boolean {
  const slice = buffer.subarray(0, Math.min(buffer.length, 1024));
  for (const byte of slice) if (byte === 0) return true;
  return false;
}

async function searchTool(args: Record<string, unknown>): Promise<ToolResult> {
  const pattern = strArg(args, "pattern");
  if (!pattern) throw new Error("search requires pattern");
  const ignoreCase = boolArg(args, "ignoreCase", false);
  const glob = strArg(args, "glob", "*") ?? "*";
  const rootArg = strArg(args, "path", ".") ?? ".";
  const root = path.resolve(process.cwd(), rootArg);
  const limit = numArg(args, "limit", 100) ?? 100;
  const regex = new RegExp(pattern, ignoreCase ? "gi" : "g");

  const files = collectFiles(root, glob, 2000);
  const hits: string[] = [];
  let scanned = 0;
  for (const file of files) {
    if (hits.length >= limit) break;
    let content: Buffer;
    try {
      const st = fs.statSync(file);
      if (st.size > 2_000_000) continue;
      content = fs.readFileSync(file);
    } catch {
      continue;
    }
    if (isProbablyBinary(content)) continue;
    scanned++;
    const lines = content.toString("utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      regex.lastIndex = 0;
      if (regex.test(lines[i] ?? "")) {
        const display = (lines[i] ?? "").trimStart().slice(0, 200);
        hits.push(`${path.relative(process.cwd(), file)}:${i + 1}: ${display}`);
        if (hits.length >= limit) break;
      }
    }
  }
  const summary = `${hits.length} match(es) across ${scanned} file(s)`;
  return textResult(
    hits.length > 0 ? [`text.search "${pattern}" — ${summary}`, ...hits].join("\n") : summary,
    { hits },
  );
}

async function replaceTool(args: Record<string, unknown>): Promise<ToolResult> {
  const find = strArg(args, "find");
  const replace = strArg(args, "replace");
  const execute = boolArg(args, "execute", false);
  if (find === undefined || find === "" || replace === undefined) {
    throw new Error("replace requires find and replace");
  }
  const glob = strArg(args, "glob", "*") ?? "*";
  const rootArg = strArg(args, "path", ".") ?? ".";
  const root = path.resolve(process.cwd(), rootArg);
  const regex = new RegExp(find, "g");

  const files = collectFiles(root, glob, 2000);
  const changes: Array<{ file: string; count: number }> = [];
  for (const file of files) {
    let content: string;
    try {
      const st = fs.statSync(file);
      if (st.size > 2_000_000) continue;
      const buf = fs.readFileSync(file);
      if (isProbablyBinary(buf)) continue;
      content = buf.toString("utf8");
    } catch {
      continue;
    }
    const matches = content.match(regex);
    if (!matches || matches.length === 0) continue;
    changes.push({ file: path.relative(process.cwd(), file), count: matches.length });
    if (execute) {
      fs.writeFileSync(file, content.replace(regex, replace), "utf8");
    }
  }

  if (changes.length === 0) return textResult("No matches found.");
  const summary = changes.map((c) => `${c.file}: ${c.count} replacement(s)`).join("\n");
  if (!execute) {
    return textResult(
      `DRY RUN — ${changes.reduce((n, c) => n + c.count, 0)} replacement(s) in ${changes.length} file(s):\n${summary}\nRe-run with execute:true to apply.`,
      { changes, executed: false },
    );
  }
  return textResult(
    `Applied ${changes.reduce((n, c) => n + c.count, 0)} replacement(s) in ${changes.length} file(s):\n${summary}`,
    { changes, executed: true },
  );
}

async function countTool(args: Record<string, unknown>): Promise<ToolResult> {
  const target = path.resolve(process.cwd(), strArg(args, "path", ".") ?? ".");
  const st = fs.statSync(target);
  let content: string;
  if (st.isFile()) {
    content = fs.readFileSync(target, "utf8");
  } else {
    const files = collectFiles(target, strArg(args, "glob", "*") ?? "*", 2000);
    content = files
      .map((f) => {
        try {
          const buf = fs.readFileSync(f);
          return isProbablyBinary(buf) ? "" : buf.toString("utf8");
        } catch {
          return "";
        }
      })
      .join("\n");
  }
  // Count lines like wc -l: a trailing newline terminates the last line
  // rather than opening an empty one.
  const lineCount =
    content.length === 0 ? 0 : content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
  const words = content.split(/\s+/).filter((w) => w.length > 0).length;
  const uniqueWords = new Set(
    content
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fff]+/)
      .filter((w) => w.length > 0),
  );
  const result = {
    lines: lineCount,
    words,
    chars: content.length,
    uniqueWords: uniqueWords.size,
  };
  return textResult(
    `lines: ${lineCount}\nwords: ${result.words}\nchars: ${result.chars}\nunique words: ${result.uniqueWords}`,
    result,
  );
}

export const textTools: ToolDefinition[] = [
  {
    name: "text.search",
    description: "Grep-like regex search across files (skips .git, node_modules, binaries)",
    risk: "low",
    owner: "core",
    params: [
      { name: "pattern", type: "string", description: "Regex to search for", required: true },
      { name: "glob", type: "string", description: "Filename glob (default *)", required: false },
      { name: "path", type: "string", description: "Root path (default cwd)", required: false },
      { name: "ignoreCase", type: "boolean", description: "Case-insensitive", required: false },
      { name: "limit", type: "number", description: "Max hits (default 100)", required: false },
    ],
    run: searchTool,
  },
  {
    name: "text.replace",
    description:
      "Regex replace across files. Dry-run by default; set execute=true to write changes",
    risk: "medium",
    owner: "core",
    params: [
      { name: "find", type: "string", description: "Regex to find", required: true },
      { name: "replace", type: "string", description: "Replacement", required: true },
      { name: "glob", type: "string", description: "Filename glob (default *)", required: false },
      { name: "path", type: "string", description: "Root path (default cwd)", required: false },
      { name: "execute", type: "boolean", description: "false = dry run", required: false },
    ],
    run: replaceTool,
  },
  {
    name: "text.count",
    description: "Count lines/words/chars/unique words of a file or directory",
    risk: "low",
    owner: "core",
    params: [
      { name: "path", type: "string", description: "Target (default cwd)", required: false },
      {
        name: "glob",
        type: "string",
        description: "Filename glob when directory",
        required: false,
      },
    ],
    run: countTool,
  },
];
