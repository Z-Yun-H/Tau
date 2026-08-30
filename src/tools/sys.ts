/**
 * System tools — sys.disk / sys.info / sys.proc plus runCapture, the shared
 * spawn-with-capture primitive used by shell-ish tools (fixed argv, no shell
 * interpretation).
 */

import os from "node:os";
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import type { ToolDefinition, ToolResult } from "../types.js";
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
];
