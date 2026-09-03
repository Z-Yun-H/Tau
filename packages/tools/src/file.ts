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

/**
 * Binary sniff shared by the file and text families: a NUL byte in the first
 * 1KB almost always means "not text" — skip instead of mangling it.
 */
export function isProbablyBinary(buffer: Buffer): boolean {
  const slice = buffer.subarray(0, Math.min(buffer.length, 1024));
  for (const byte of slice) if (byte === 0) return true;
  return false;
}

/**
 * Extension → language id map shared with the WebUI file viewer (shiki).
 * Keys are lowercase extensions; values are shiki-compatible language ids.
 * Deliberately modest: unknown extensions fall back to "text", which shiki
 * renders as plain text — a wrong guess is worse than no highlighting.
 */
const EXTENSION_LANGUAGES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  py: "python",
  rb: "ruby",
  php: "php",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  cs: "csharp",
  sql: "sql",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  xml: "xml",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "less",
  md: "markdown",
  markdown: "markdown",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  vue: "vue",
  svelte: "svelte",
};

/** Whole-basename (not extension) language detection, lowercase keys. */
const EXACT_NAME_LANGUAGES: Record<string, string> = {
  dockerfile: "dockerfile",
  containerfile: "dockerfile",
  makefile: "makefile",
  gemfile: "ruby",
  rakefile: "ruby",
};

/**
 * Best-effort language id for a file name (shiki-compatible), for syntax
 * -highlighted viewers: file.read reports it in its structured result and
 * the WebUI file viewer picks a highlighter with it (issue #110). The last
 * extension wins ("archive.tar.gz" → "gz" → text); dotfiles like
 * .gitignore have no extension; anything unknown is plain "text".
 */
export function languageForFile(name: string): string {
  const base = path.basename(name).toLowerCase();
  const exact = EXACT_NAME_LANGUAGES[base];
  if (exact !== undefined) return exact;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "text"; // no extension, or a dotfile like .gitignore
  return EXTENSION_LANGUAGES[base.slice(dot + 1)] ?? "text";
}

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
      const typeMatches =
        type === "any" ||
        (type === "dir" && entry.isDirectory()) ||
        (type === "file" && entry.isFile());
      if (entry.isDirectory()) {
        if (typeMatches && regex.test(entry.name + "/")) results.push(rel(root, full) + "/");
        walk(full, depth + 1);
      } else if (entry.isFile() && typeMatches && regex.test(entry.name)) {
        results.push(rel(root, full));
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

/** Read a text file with line numbers — offset/limit capped, binary-guarded. */
async function readTool(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = process.cwd();
  const targetArg = strArg(args, "path");
  if (!targetArg) throw new Error("read requires path");
  const target = resolveInside(cwd, targetArg);
  if (!fs.existsSync(target)) throw new Error(`Path does not exist: ${target}`);
  const st = fs.statSync(target);
  if (st.isDirectory()) throw new Error(`path is a directory: ${target}`);
  if (st.size > 2_000_000) throw new Error(`file too large to read (>2MB): ${target}`);

  const buf = fs.readFileSync(target);
  if (isProbablyBinary(buf)) throw new Error(`refusing to read binary file: ${target}`);

  const offset = Math.max(numArg(args, "offset", 1) ?? 1, 1);
  const limit = Math.min(Math.max(numArg(args, "limit", 400) ?? 400, 1), 2000);
  const lines = buf.toString("utf8").split("\n");
  const total = lines.length;
  const slice = lines.slice(offset - 1, offset - 1 + limit);
  const numbered = slice.map((line, i) => {
    const no = offset + i;
    const display = line.length > 300 ? `${line.slice(0, 300)}…` : line;
    return `${String(no).padStart(4, " ")}  ${display}`;
  });
  const truncated = offset - 1 + slice.length < total;
  const head = `file.read ${targetArg} — lines ${offset}-${offset - 1 + slice.length} of ${total}${truncated ? " (truncated, raise limit or offset)" : ""}`;
  return textResult([head, ...numbered].join("\n"), {
    path: targetArg,
    language: languageForFile(targetArg),
    offset,
    returned: slice.length,
    totalLines: total,
    truncated,
  });
}

/** Single-directory listing (non-recursive): type, bytes, mtime, name. */
async function listTool(args: Record<string, unknown>): Promise<ToolResult> {
  const cwd = process.cwd();
  const dirArg = strArg(args, "path", ".") ?? ".";
  const dir = resolveInside(cwd, dirArg);
  if (!fs.existsSync(dir)) throw new Error(`Path does not exist: ${dir}`);
  const st = fs.statSync(dir);
  if (!st.isDirectory()) throw new Error(`not a directory: ${dir}`);

  const includeHidden = boolArg(args, "includeHidden", false);
  const limit = Math.min(Math.max(numArg(args, "limit", 200) ?? 200, 1), 1000);
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => includeHidden || !e.name.startsWith("."))
    .sort(
      (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
    )
    .slice(0, limit);

  const rows = entries.map((entry) => {
    const full = path.join(dir, entry.name);
    const es = fs.statSync(full);
    const kind = entry.isDirectory() ? "d" : entry.isFile() ? "f" : "?";
    return `${kind}  ${String(es.size).padStart(9, " ")}  ${es.mtime.toISOString()}  ${entry.name}${entry.isDirectory() ? "/" : ""}`;
  });
  const head = `file.list ${dirArg} — ${rows.length} entr${rows.length === 1 ? "y" : "ies"}`;
  return textResult([head, ...rows].join("\n"), { count: rows.length });
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

/**
 * file.write — the first-party WRITE primitive (v0.4.0, issue #96).
 *
 * Deliberately the ONLY file-mutating addition to the no-delete family:
 * overwrite/append of a TEXT file inside the workspace, dry-run by default
 * (golden rule 3). Refuses: paths escaping the workspace (see
 * {@link escapesWorkspace}), system locations (see {@link isSystemWritePath}),
 * directory targets, binary overwrites, content over 2MB, and missing parent
 * directories unless createDirs=true. The safety reviewer layers its own
 * path checks on top (defense in depth — reviewer only ever strengthened).
 */
const MAX_WRITE_BYTES = 2_000_000;
const PREVIEW_LINES = 12;

/**
 * True when `target` resolves OUTSIDE `base` (absolute escape or `..` climb).
 * Exported for the engine's safety reviewer — one containment definition,
 * two enforcement points (tool refuses; reviewer escalates).
 */
export function escapesWorkspace(target: string, base: string = process.cwd()): boolean {
  const rel = path.relative(path.resolve(base), path.resolve(base, target));
  return rel.startsWith("..") || path.isAbsolute(rel);
}

/**
 * True when `target` points into an OS-managed location a terminal assistant
 * has no business writing (system config, executables, kernel mounts).
 * Exported for the safety reviewer (blocked-level escalation).
 */
export function isSystemWritePath(
  target: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const normalized = target.replaceAll("\\", "/").toLowerCase();
  const systemPrefixes =
    platform === "win32"
      ? ["c:/windows", "c:/program files"]
      : [
          "/etc/",
          "/usr/",
          "/bin/",
          "/sbin/",
          "/lib/",
          "/lib64/",
          "/boot/",
          "/dev/",
          "/proc/",
          "/sys/",
          "/opt/",
          "/var/",
        ];
  const exact = platform === "win32" ? [] : ["/etc", "/usr", "/bin", "/sbin", "/lib", "/lib64"];
  return (
    exact.includes(normalized) || systemPrefixes.some((prefix) => normalized.startsWith(prefix))
  );
}

function diffStat(oldText: string, newText: string): { added: number; removed: number } {
  const oldLines = new Set(oldText.split("\n"));
  const newLines = new Set(newText.split("\n"));
  let added = 0;
  let removed = 0;
  for (const line of newLines) if (!oldLines.has(line)) added += 1;
  for (const line of oldLines) if (!newLines.has(line)) removed += 1;
  return { added, removed };
}

async function writeTool(args: Record<string, unknown>): Promise<ToolResult> {
  const targetArg = strArg(args, "path", "") ?? "";
  if (!targetArg.trim()) throw new Error("file.write: path is required");
  if (escapesWorkspace(targetArg)) {
    throw new Error(`file.write refuses paths outside the workspace: ${targetArg}`);
  }
  const target = resolveInside(process.cwd(), targetArg);
  if (isSystemWritePath(target)) {
    throw new Error(`file.write refuses system locations: ${target}`);
  }

  const content = strArg(args, "content", "") ?? "";
  if (Buffer.byteLength(content, "utf8") > MAX_WRITE_BYTES) {
    throw new Error(`file.write content exceeds the ${MAX_WRITE_BYTES}-byte cap`);
  }
  const mode = (strArg(args, "mode", "overwrite") ?? "overwrite").toLowerCase();
  if (mode !== "overwrite" && mode !== "append") {
    throw new Error(`file.write: mode must be "overwrite" or "append" (got "${mode}")`);
  }
  const createDirs = boolArg(args, "createDirs", false);
  const execute = boolArg(args, "execute", false);

  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    throw new Error(`file.write: target is a directory: ${target}`);
  }

  const exists = fs.existsSync(target);
  let previous = "";
  if (exists) {
    const buffer = fs.readFileSync(target);
    if (isProbablyBinary(buffer)) {
      throw new Error(`file.write refuses to overwrite a binary file: ${target}`);
    }
    previous = buffer.toString("utf8");
  }

  const bytes = Buffer.byteLength(content, "utf8");
  const lines = content.length === 0 ? 0 : content.split("\n").length;

  if (!execute) {
    const preview: string[] = [];
    preview.push(`DRY RUN — file.write (${mode}) ${targetArg}`);
    preview.push(
      exists
        ? `target exists: ${bytes} new byte(s), ${lines} line(s)`
        : `new file: ${bytes} byte(s), ${lines} line(s)`,
    );
    if (mode === "overwrite" && exists) {
      const { added, removed } = diffStat(previous, content);
      preview.push(`changes: +${added} / -${removed} line(s)`);
    }
    if (mode === "append" && exists) {
      const tail = previous.split("\n").slice(-3);
      preview.push(`current tail: ${tail.join(" ⏎ ").slice(0, 200)}`);
    }
    preview.push(
      "preview (first lines of the result):",
      ...content
        .split("\n")
        .slice(0, PREVIEW_LINES)
        .map((line, index) => `  ${index + 1}: ${line.slice(0, 200)}`),
    );
    if (lines > PREVIEW_LINES) preview.push(`  ... (${lines - PREVIEW_LINES} more line(s))`);
    preview.push("set execute=true to apply.");
    return textResult(preview.join("\n"), { dryRun: true, target: targetArg, mode, bytes });
  }

  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) {
    if (!createDirs) {
      throw new Error(`file.write: parent directory does not exist: ${dir} (set createDirs=true)`);
    }
    fs.mkdirSync(dir, { recursive: true });
  }
  if (mode === "append" && exists) fs.appendFileSync(target, content);
  else fs.writeFileSync(target, content, mode === "append" ? { flag: "a" } : {});
  return textResult(`Wrote ${bytes} byte(s) (${mode}) -> ${targetArg}`, {
    executed: true,
    target: targetArg,
    mode,
    bytes,
  });
}

export const fileTools: ToolDefinition[] = [
  {
    name: "file.write",
    description:
      "Write (overwrite/append) a text file inside the workspace. DRY RUN by default: shows the target, sizes and a preview; set execute=true to apply",
    risk: "medium",
    owner: "core",
    mutates: true,
    dryRunDefault: true,
    params: [
      {
        name: "path",
        type: "string",
        description: "Target file path (workspace-relative)",
        required: true,
      },
      {
        name: "content",
        type: "string",
        description: "Full file content (overwrite) or the appended tail",
        required: true,
      },
      {
        name: "mode",
        type: "string",
        description: "overwrite (default) | append",
        required: false,
      },
      {
        name: "createDirs",
        type: "boolean",
        description: "Create missing parent directories (default false)",
        required: false,
      },
      { name: "execute", type: "boolean", description: "false = dry run preview", required: false },
    ],
    run: writeTool,
  },
  {
    name: "file.read",
    description:
      "Read a text file with line numbers (offset/limit, refuses binaries and files over 2MB); the structured result reports the detected language for highlighted viewers",
    risk: "low",
    owner: "core",
    params: [
      { name: "path", type: "string", description: "File path", required: true },
      {
        name: "offset",
        type: "number",
        description: "1-based start line (default 1)",
        required: false,
      },
      {
        name: "limit",
        type: "number",
        description: "Max lines, cap 2000 (default 400)",
        required: false,
      },
    ],
    run: readTool,
  },
  {
    name: "file.list",
    description: "List one directory (non-recursive): type, bytes, mtime, name",
    risk: "low",
    owner: "core",
    params: [
      { name: "path", type: "string", description: "Directory (default cwd)", required: false },
      { name: "limit", type: "number", description: "Max entries (default 200)", required: false },
      { name: "includeHidden", type: "boolean", description: "Include dotfiles", required: false },
    ],
    run: listTool,
  },
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
    mutates: true,
    dryRunDefault: true,
    params: [
      { name: "find", type: "string", description: "Regex to match in filenames", required: true },
      { name: "replace", type: "string", description: "Replacement string", required: true },
      { name: "path", type: "string", description: "Directory (default: cwd)", required: false },
      { name: "execute", type: "boolean", description: "false = dry run", required: false },
    ],
    run: renameTool,
  },
];
