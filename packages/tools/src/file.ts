/**
 * File tools — file.find / file.stat / file.tree / file.rename.
 * find/tree prune node_modules and .git; rename defaults to dry-run and
 * refuses to overwrite; every tool is pure registry-driven, no shell.
 */

import fs from "node:fs";
import path from "node:path";
import type { ToolDefinition, ToolResult } from "@tau/core";
import { boolArg, numArg, strArg, textResult } from "./registry.js";

/**
 * file.* — filesystem inspection and controlled mutation.
 *
 * Design note: there is deliberately NO delete tool. The AI planner must never
 * have a first-party delete primitive; deleting goes through reviewed shell
 * steps or the user's own hands. See docs/safety.md.
 */

function resolveInside(cwd: string, target: string): string {
  return path.resolve(cwd, target);
}

/** Directories never worth searching (shared with tree/text). */
export const PRUNE_DIRS = new Set(["node_modules", ".git", "dist", ".tau", "coverage"]);

async function findTool(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = process.cwd();
  const root = resolveInside(cwd, strArg(args, "path", ".") ?? ".");
  const pattern = strArg(args, "pattern", "*") ?? "*";
  const type = strArg(args, "type", "any") ?? "any";
  const limit = numArg(args, "limit", 200) ?? 200;
  const includeHidden = boolArg(args, "includeHidden", false);
  const includeJunk = boolArg(args, "includeNodeModules", false);

  if (!fs.existsSync(root)) {
    throw new Error(`Path does not exist: ${root}`);
  }

  // Fast, dependency-free glob-ish matcher: translate *, **, ? to regex.
  const regex = globToRegex(pattern);
  const results: string[] = [];

  const walk = (dir: string, depth: number): void => {
    if (results.length >= limit || depth > 12) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= limit) return;
      if (!includeHidden && entry.name.startsWith(".")) continue;
      if (!includeJunk && entry.isDirectory() && PRUNE_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (regex.test(entry.name + "/")) results.push(rel(root, full) + "/");
        walk(full, depth + 1);
      } else if (entry.isFile()) {
        const matchesType =
          type === "any" ||
          (type === "file" && entry.isFile()) ||
          (type === "dir" && entry.isDirectory());
        if (matchesType && regex.test(entry.name)) {
          results.push(rel(root, full));
        }
      }
    }
  };

  const stat = fs.statSync(root);
  if (stat.isFile()) {
    results.push(rel(path.dirname(root), root));
  } else {
    walk(root, 0);
  }

  const summary =
    results.length >= limit
      ? `showing first ${limit} (use limit to raise)`
      : `${results.length} match(es)`;
  return textResult([`file.find in ${root} — ${summary}`, ...results].join("\n"), {
    matches: results,
  });
}

function rel(root: string, full: string): string {
  const r = path.relative(root, full);
  return r.length === 0 ? path.basename(full) : r;
}

export function globToRegex(pattern: string): RegExp {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === undefined) break;
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        out += ".*";
        i++;
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

async function statTool(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = process.cwd();
  const target = resolveInside(cwd, strArg(args, "path", ".") ?? ".");
  const st = fs.statSync(target);
  const lines = [
    `path: ${target}`,
    `type: ${st.isDirectory() ? "directory" : st.isFile() ? "file" : "other"}`,
    `size: ${st.size} bytes`,
    `modified: ${st.mtime.toISOString()}`,
  ];
  if (st.isDirectory()) {
    const entries = fs.readdirSync(target);
    lines.push(`entries: ${entries.length}`);
  }
  return textResult(lines.join("\n"), { size: st.size, mtime: st.mtime.toISOString() });
}

async function treeTool(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = process.cwd();
  const root = resolveInside(cwd, strArg(args, "path", ".") ?? ".");
  const depth = Math.min(numArg(args, "depth", 2) ?? 2, 6);
  if (!fs.existsSync(root)) throw new Error(`Path does not exist: ${root}`);

  const lines: string[] = [path.basename(root) + "/"];
  const walk = (dir: string, indent: string, level: number): void => {
    if (level > depth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => !e.name.startsWith(".") && !PRUNE_DIRS.has(e.name))
        .sort(
          (a, b) =>
            Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
        );
    } catch {
      return;
    }
    entries.forEach((entry, i) => {
      const last = i === entries.length - 1;
      lines.push(
        `${indent}${last ? "└── " : "├── "}${entry.name}${entry.isDirectory() ? "/" : ""}`,
      );
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), indent + (last ? "    " : "│   "), level + 1);
      }
    });
  };
  walk(root, "", 1);
  return textResult(lines.join("\n"));
}

/** Batch rename. ALWAYS dry-run unless execute=true — safety first. */
async function renameTool(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = process.cwd();
  const dir = resolveInside(cwd, strArg(args, "path", ".") ?? ".");
  const find = strArg(args, "find");
  const replace = strArg(args, "replace");
  const execute = boolArg(args, "execute", false);
  if (!find || replace === undefined) {
    throw new Error("rename requires find and replace");
  }

  const regex = new RegExp(find, "g");
  const renames: Array<{ from: string; to: string }> = [];
  for (const entry of fs.readdirSync(dir)) {
    if (!regex.test(entry)) continue;
    regex.lastIndex = 0;
    const to = entry.replace(regex, replace);
    if (to !== entry && to.length > 0) renames.push({ from: entry, to });
  }

  if (renames.length === 0) return textResult("No files match the find pattern.");

  const plan = renames.map((r) => `${r.from} -> ${r.to}`).join("\n");
  if (!execute) {
    return textResult(
      `DRY RUN — ${renames.length} rename(s) would happen:\n${plan}\nRe-run with execute:true to apply.`,
      { renames, executed: false },
    );
  }
  const done: string[] = [];
  for (const r of renames) {
    const from = path.join(dir, r.from);
    const to = path.join(dir, r.to);
    if (fs.existsSync(to)) {
      done.push(`SKIP (target exists): ${r.to}`);
      continue;
    }
    fs.renameSync(from, to);
    done.push(`${r.from} -> ${r.to}`);
  }
  return textResult(`Renamed ${done.length} item(s):\n${done.join("\n")}`, {
    executed: true,
    done,
  });
}

export const fileTools: ToolDefinition[] = [
  {
    name: "file.find",
    description: "Recursively find files/directories by glob pattern under a path",
    risk: "low",
    owner: "core",
    params: [
      {
        name: "pattern",
        type: "string",
        description: "Glob like *.ts or **/*test*",
        required: true,
      },
      { name: "path", type: "string", description: "Root path (default: cwd)", required: false },
      { name: "type", type: "string", description: "any | file | dir", required: false },
      { name: "limit", type: "number", description: "Max results (default 200)", required: false },
      { name: "includeHidden", type: "boolean", description: "Include dotfiles", required: false },
      {
        name: "includeNodeModules",
        type: "boolean",
        description: "Include node_modules/.git/dist",
        required: false,
      },
    ],
    run: findTool,
  },
  {
    name: "file.stat",
    description: "Show size, type and mtime of a file or directory",
    risk: "low",
    owner: "core",
    params: [{ name: "path", type: "string", description: "Target path", required: true }],
    run: statTool,
  },
  {
    name: "file.tree",
    description: "Print a directory tree up to a depth limit",
    risk: "low",
    owner: "core",
    params: [
      { name: "path", type: "string", description: "Root path (default: cwd)", required: false },
      {
        name: "depth",
        type: "number",
        description: "Max depth (default 2, max 6)",
        required: false,
      },
    ],
    run: treeTool,
  },
  {
    name: "file.rename",
    description:
      "Batch rename files in a directory by regex. Dry-run by default; set execute=true to apply",
    risk: "medium",
    owner: "core",
    params: [
      { name: "find", type: "string", description: "Regex to match in filenames", required: true },
      { name: "replace", type: "string", description: "Replacement string", required: true },
      { name: "path", type: "string", description: "Directory (default: cwd)", required: false },
      { name: "execute", type: "boolean", description: "false = dry run", required: false },
    ],
    run: renameTool,
  },
];
