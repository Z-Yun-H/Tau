/**
 * System tools — sys.disk / sys.info / sys.proc plus runCapture, the shared
 * spawn-with-capture primitive used by shell-ish tools (fixed argv, no shell
 * interpretation). Also sys.datetime / sys.which / sys.env: the time,
 * command-resolution and environment senses a local harness needs.
 */

import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ToolDefinition, ToolResult } from "@tau/core";
import { numArg, strArg, textResult } from "./registry.js";

/**
 * sys.* — system inspection. Read-only by design.
 * proc uses platform ps; kill is intentionally NOT provided (see docs/safety.md).
 */

function bytesToHuman(n: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

async function infoTool(): Promise<ToolResult> {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedPct = (((totalMem - freeMem) / totalMem) * 100).toFixed(1);
  const lines = [
    `hostname: ${os.hostname()}`,
    `platform: ${os.platform()} ${os.release()} (${os.arch()})`,
    `os: ${os.type()} — ${os.version()}`,
    `cpu: ${os.cpus()[0]?.model.trim() ?? "unknown"} x${os.cpus().length}`,
    `loadavg: ${os
      .loadavg()
      .map((n) => n.toFixed(2))
      .join(" / ")}`,
    `memory: ${bytesToHuman(totalMem - freeMem)} / ${bytesToHuman(totalMem)} (${usedPct}% used)`,
    `uptime: ${(os.uptime() / 3600).toFixed(1)} h`,
    `node: ${process.version}`,
  ];
  return textResult(lines.join("\n"));
}

async function diskTool(args: Record<string, unknown>): Promise<ToolResult> {
  const target = strArg(args, "path", process.cwd()) ?? process.cwd();
  // fs.statfs is available since Node 18.15/19.6.
  const st = (await fs.statfs(target)) as {
    blocks: number;
    bsize: number;
    bavail: number;
    bfree: number;
  };
  const total = st.blocks * st.bsize;
  const free = st.bavail * st.bsize;
  const used = total - free;
  const pct = total > 0 ? ((used / total) * 100).toFixed(1) : "0";
  const lines = [
    `path: ${target}`,
    `total: ${bytesToHuman(total)}`,
    `used: ${bytesToHuman(used)} (${pct}%)`,
    `free: ${bytesToHuman(free)}`,
  ];
  return textResult(lines.join("\n"), { total, used, free });
}

/** Run a command and capture stdout. Small helper shared by sys.proc / net.ping. */
export function runCapture(
  cmd: string,
  args: string[],
  timeoutMs = 15000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { shell: false });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: String(err) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

async function procTool(args: Record<string, unknown>): Promise<ToolResult> {
  const limit = numArg(args, "limit", 15) ?? 15;
  if (process.platform === "win32") {
    return textResult("sys.proc is not supported on Windows yet (planned). Try: tasklist | more");
  }
  const { code, stdout, stderr } = await runCapture("ps", ["aux"], 10000);
  if (code !== 0) return textResult(`ps failed (exit ${code}): ${stderr.trim()}`);
  const lines = stdout.trim().split("\n");
  const header = lines[0] ?? "";
  const rows = lines
    .slice(1)
    .map((line) => ({ line, cpu: Number(line.split(/\s+/)[2] ?? 0) }))
    .sort((a, b) => b.cpu - a.cpu)
    .slice(0, limit)
    .map((r) => r.line);
  return textResult([header, ...rows].join("\n"), { count: rows.length });
}

/** Current date/time in every useful shape (local, ISO, epoch, timezone). */
async function datetimeTool(): Promise<ToolResult> {
  const d = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offsetMin = -d.getTimezoneOffset();
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const utcOffset = `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  const lines = [
    `local: ${d.toString()}`,
    `iso: ${d.toISOString()}`,
    `epoch_ms: ${d.getTime()}`,
    `timezone: ${timeZone} (${utcOffset})`,
  ];
  return textResult(lines.join("\n"), {
    iso: d.toISOString(),
    epochMs: d.getTime(),
    timezone: timeZone,
    utcOffset,
  });
}

/** Resolve a bare command name through PATH — read-only, no execution. */
async function whichTool(args: Record<string, unknown>): Promise<ToolResult> {
  const name = strArg(args, "command") ?? "";
  if (!name) throw new Error("which requires command");
  if (/[\\/]/.test(name)) {
    throw new Error("which expects a bare command name (no path separators)");
  }
  const dirs = (process.env["PATH"] ?? "").split(path.delimiter).filter((d) => d.length > 0);
  const extensions = process.platform === "win32" ? [".exe", ".cmd", ".bat", "", ".com"] : [""];
  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = path.join(dir, name + ext);
      try {
        const st = await fs.stat(candidate);
        if (st.isFile()) {
          return textResult(`${name} -> ${candidate}`, { path: candidate });
        }
      } catch {
        // not here — keep scanning PATH
      }
    }
  }
  return textResult(`not found in PATH: ${name}`, { path: undefined });
}

/** Read ONE environment variable by exact NAME (medium: env may hold secrets). */
async function envTool(args: Record<string, unknown>): Promise<ToolResult> {
  const name = strArg(args, "name") ?? "";
  if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error("env requires a variable NAME (letters, digits, underscore)");
  }
  const value = process.env[name];
  if (value === undefined) {
    return textResult(`${name} is not set`, { set: false });
  }
  const display = value.length > 512 ? `${value.slice(0, 512)}… (${value.length} chars)` : value;
  return textResult(`${name}=${display}`, { set: true, length: value.length });
}

export const sysTools: ToolDefinition[] = [
  {
    name: "sys.info",
    description: "OS, CPU, memory and uptime summary of this machine",
    risk: "low",
    owner: "core",
    params: [],
    run: infoTool,
  },
  {
    name: "sys.disk",
    description: "Disk usage (total/used/free) for a path",
    risk: "low",
    owner: "core",
    params: [
      { name: "path", type: "string", description: "Path to stat (default: cwd)", required: false },
    ],
    run: diskTool,
  },
  {
    name: "sys.proc",
    description: "Top processes by CPU usage (read-only ps snapshot)",
    risk: "low",
    owner: "core",
    params: [
      { name: "limit", type: "number", description: "How many rows (default 15)", required: false },
    ],
    run: procTool,
  },
  {
    name: "sys.datetime",
    description: "Current date/time: local, ISO, epoch ms, timezone with UTC offset",
    risk: "low",
    owner: "core",
    params: [],
    run: datetimeTool,
  },
  {
    name: "sys.which",
    description:
      "Resolve a bare command name to its absolute PATH location (read-only, no execution)",
    risk: "low",
    owner: "core",
    params: [
      {
        name: "command",
        type: "string",
        description: "Bare command name (no path separators)",
        required: true,
      },
    ],
    run: whichTool,
  },
  {
    name: "sys.env",
    description: "Read one environment variable by exact NAME (medium risk: env may hold secrets)",
    risk: "medium",
    owner: "core",
    params: [
      {
        name: "name",
        type: "string",
        description: "Variable name (letters, digits, underscore)",
        required: true,
      },
    ],
    run: envTool,
  },
];
