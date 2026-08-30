import net from "node:net";
import os from "node:os";
import type { ToolDefinition, ToolResult } from "../types.js";
import { numArg, strArg, textResult } from "./registry.js";
import { runCapture } from "./sys.js";

/**
 * net.* — network diagnostics. Safe subset: check, ping, fetch, ip.
 * Port scanning ranges are NOT supported (single-host single-port only).
 */

function checkPort(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(port, host);
  });
}

async function portTool(args: Record<string, unknown>): Promise<ToolResult> {
  const host = strArg(args, "host", "localhost") ?? "localhost";
  const port = numArg(args, "port");
  if (port === undefined || port < 1 || port > 65535) {
    throw new Error("port must be an integer between 1 and 65535");
  }
  const timeout = Math.min((numArg(args, "timeout", 3) ?? 3) * 1000, 15000);
  const open = await checkPort(host, port, timeout);
  return textResult(open ? `OPEN  ${host}:${port}` : `CLOSED/UNREACHABLE  ${host}:${port}`, {
    open,
  });
}

async function pingTool(args: Record<string, unknown>): Promise<ToolResult> {
  const host = strArg(args, "host");
  if (!host || /[;&|`$]/.test(host)) {
    throw new Error("ping requires a plain host or IP (no shell metacharacters)");
  }
  const count = Math.min(numArg(args, "count", 4) ?? 4, 10);
  const flag = process.platform === "win32" ? "-n" : "-c";
  const { code, stdout, stderr } = await runCapture("ping", [flag, String(count), host], 30000);
  if (code !== 0 && stdout.trim() === "") {
    return textResult(`ping failed (exit ${code}): ${stderr.trim() || "host unreachable"}`);
  }
  return textResult(stdout.trim());
}

async function fetchTool(args: Record<string, unknown>): Promise<ToolResult> {
  const url = strArg(args, "url");
  if (!url || !/^https?:\/\//.test(url)) {
    throw new Error("fetch requires an absolute http(s) URL");
  }
  // SSRF guard: block obvious internal targets unless explicitly allowed.
  const allowPrivate = args["allowPrivate"] === true;
  const parsed = new URL(url);
  const hostname = parsed.hostname;
  const isPrivate =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "0.0.0.0" ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname);
  if (isPrivate && !allowPrivate) {
    throw new Error(
      `Refusing to fetch private address ${hostname} by default (pass allowPrivate:true to override)`,
    );
  }

  const method = strArg(args, "method", "GET") ?? "GET";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      redirect: "follow",
    });
    const body = await res.text();
    const preview =
      body.length > 2000 ? body.slice(0, 2000) + `\n... (${body.length} bytes total)` : body;
    const headers = [...res.headers.entries()]
      .slice(0, 10)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
    return textResult(
      `${method} ${url}\nstatus: ${res.status} ${res.statusText}\n\n${headers}\n\n${preview}`,
      { status: res.status, bodyLength: body.length },
    );
  } finally {
    clearTimeout(timer);
  }
}

async function ipTool(): Promise<ToolResult> {
  const ifaces = os.networkInterfaces();
  const lines: string[] = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const addr of addrs ?? []) {
      if (addr.internal) continue;
      lines.push(`${name}: ${addr.address} (${addr.family})`);
    }
  }
  if (lines.length === 0) lines.push("(no external interfaces)");
  return textResult(lines.join("\n"));
}

export const netTools: ToolDefinition[] = [
  {
    name: "net.port",
    description: "Check whether a single TCP port on a host is open",
    risk: "low",
    owner: "core",
    params: [
      {
        name: "host",
        type: "string",
        description: "Hostname or IP (default localhost)",
        required: false,
      },
      { name: "port", type: "number", description: "TCP port 1-65535", required: true },
      { name: "timeout", type: "number", description: "Seconds (default 3)", required: false },
    ],
    run: portTool,
  },
  {
    name: "net.ping",
    description: "Ping a host a few times using the system ping binary",
    risk: "low",
    owner: "core",
    params: [
      { name: "host", type: "string", description: "Hostname or IP", required: true },
      { name: "count", type: "number", description: "Packets 1-10 (default 4)", required: false },
    ],
    run: pingTool,
  },
  {
    name: "net.fetch",
    description: "HTTP GET a URL and show status, headers and a body preview (SSRF-guarded)",
    risk: "low",
    owner: "core",
    params: [
      { name: "url", type: "string", description: "Absolute http(s) URL", required: true },
      { name: "method", type: "string", description: "HTTP method (default GET)", required: false },
      {
        name: "allowPrivate",
        type: "boolean",
        description: "Allow private addresses",
        required: false,
      },
    ],
    run: fetchTool,
  },
  {
    name: "net.ip",
    description: "List local network interface addresses",
    risk: "low",
    owner: "core",
    params: [],
    run: ipTool,
  },
];
