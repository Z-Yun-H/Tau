/**
 * tau net — direct access to the network tools (fetch/ip/ping/port) without
 * going through the AI. Same SSRF guards and shell-metacharacter rejections.
 */

import type { Command } from "commander";
import { runToolDirect } from "./util.js";

export function registerNetCommands(program: Command): void {
  const net = program
    .command("net")
    .description("Network diagnostics: port check, ping, fetch, local IP");

  net
    .command("port")
    .description("Check if a TCP port is open")
    .argument("<port>", "port number 1-65535")
    .option("-H, --host <host>", "hostname", "localhost")
    .option("-t, --timeout <sec>", "seconds", "3")
    .action(async (port: string, opts) => {
      await runToolDirect(
        "net.port",
        { port: Number(port), host: opts.host, timeout: Number(opts.timeout) },
        `net port ${opts.host}:${port}`,
      );
    });

  net
    .command("ping")
    .description("Ping a host with the system ping binary")
    .argument("<host>", "hostname or IP")
    .option("-c, --count <n>", "packets 1-10", "4")
    .action(async (host: string, opts) => {
      await runToolDirect("net.ping", { host, count: Number(opts.count) }, `net ping ${host}`);
    });

  net
    .command("fetch")
    .description("HTTP GET with status/headers/body preview (SSRF-guarded)")
    .argument("<url>", "absolute http(s) URL")
    .option("-m, --method <method>", "HTTP method", "GET")
    .option("--allow-private", "allow private/internal addresses", false)
    .action(async (url: string, opts) => {
      await runToolDirect(
        "net.fetch",
        { url, method: opts.method, allowPrivate: opts.allowPrivate === true },
        `net fetch ${url}`,
      );
    });

  net
    .command("ip")
    .description("Show local interface addresses")
    .action(async () => {
      await runToolDirect("net.ip", {}, "net ip");
    });
}
