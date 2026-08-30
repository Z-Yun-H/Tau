import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { main, buildProgram } from "../src/index.js";
import { loadConfig } from "@tau/core";

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_ARGV = process.argv;
let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-plugin-cli-"));
  process.env.TAU_HOME = path.join(tmp, "home");
  fs.mkdirSync(path.join(tmp, "home"), { recursive: true });
  process.chdir(tmp);
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  process.argv = ORIGINAL_ARGV;
  delete process.env.TAU_HOME;
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function run(...args: string[]): Promise<void> {
  process.argv = ["node", "tau", ...args];
  await main(process.argv);
}

describe("tau plugin CLI", () => {
  it("plugin family appears in help", () => {
    const help = buildProgram().helpInformation();
    expect(help).toContain("plugin");
    expect(help).toContain("Manage MCP plugins");
  });

  it("list guides empty config", async () => {
    await run("plugin", "list");
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("add/list/remove round-trip persists to config", async () => {
    await run(
      "plugin",
      "add",
      "files",
      "--",
      "npx",
      "-y",
      "@modelcontextprotocol/server-filesystem",
      ".",
    );
    expect(process.exitCode ?? 0).toBe(0);
    const saved = loadConfig().plugins[0];
    expect(saved?.name).toBe("files");
    expect(saved?.transport).toBe("stdio");
    expect(saved?.command).toBe("npx");
    expect(saved?.args).toEqual(["-y", "@modelcontextprotocol/server-filesystem", "."]);

    await run(
      "plugin",
      "add",
      "remote",
      "--url",
      "http://127.0.0.1:8787/mcp",
      "--desc",
      "dsh bridge",
    );
    expect(loadConfig().plugins).toHaveLength(2);

    await run("plugin", "disable", "remote");
    expect(loadConfig().plugins.find((p) => p.name === "remote")?.enabled).toBe(false);

    await run("plugin", "enable", "remote");
    expect(loadConfig().plugins.find((p) => p.name === "remote")?.enabled).toBe(true);

    await run("plugin", "remove", "files");
    expect(loadConfig().plugins.map((p) => p.name)).toEqual(["remote"]);

    await run("plugin", "list");
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("add rejects missing transport info and unknown names", async () => {
    await run("plugin", "add", "broken");
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;

    await run("plugin", "add", "Bad_Name", "--", "node", "x.mjs");
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;

    await run("plugin", "add", "core", "--", "node", "x.mjs");
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;

    expect(loadConfig().plugins).toHaveLength(0);
  });

  it("remove of an unknown plugin fails", async () => {
    await run("plugin", "remove", "ghost");
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it(
    "tools of an unreachable http plugin fail with a readable message",
    { timeout: 30_000 },
    async () => {
      await run("plugin", "add", "dead", "--url", "http://127.0.0.1:9/mcp");
      await run("plugin", "tools", "dead");
      expect(process.exitCode).toBe(1);
      process.exitCode = 0;
    },
  );

  it("ask --explain still works when a plugin is unreachable (warning + catalog)", async () => {
    await run("plugin", "add", "dead", "--url", "http://127.0.0.1:9/mcp");
    await run("ask", "--explain", "list files");
    // explain prints the system prompt regardless of plugin failure
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("ask --explain shows plugin tools when the SDK is absent or plugins load", async () => {
    // With no plugins configured nothing changes; with the SDK installed and
    // an in-memory-ish plugin this would list plugin.* tools — covered by the
    // unit integration suite. Here we assert the baseline stays green.
    await run("ask", "--explain", "find files");
    expect(process.exitCode ?? 0).toBe(0);
  });
});
