import { describe, it, expect, afterAll } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import {
  callMcpTool,
  handshake,
  listMcpTools,
  loadMcpSdk,
  mcpToolsToDefinitions,
} from "../src/mcp.js";
import type { PluginConfig } from "@tau/core";

/**
 * Real MCP SDK integration over InMemoryTransport: exercises the same
 * client/list/call path Tau uses for stdio/http plugins, without spawning
 * processes.
 */

const plugin: PluginConfig = { name: "mock", transport: "http", url: "http://in-memory/unused" };

interface Pair {
  client: Awaited<ReturnType<typeof handshake>>;
  server: McpServer;
}

const pairs: Pair[] = [];

async function makePair(): Promise<Pair> {
  const sdk = await loadMcpSdk();
  if (!sdk) throw new Error("MCP SDK not installed");
  const server = new McpServer({ name: "tau-test-server", version: "0.1.0" });
  server.tool("echo", "echo the message back", { message: z.string() }, async ({ message }) => ({
    content: [{ type: "text", text: `echo: ${message}` }],
  }));
  server.tool("boom", "always fails", {}, async () => ({
    content: [{ type: "text", text: "kaboom reason" }],
    isError: true,
  }));
  server.tool("we ird/name!", "odd name", {}, async () => ({
    content: [{ type: "text", text: "ok" }],
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = await handshake(sdk, clientTransport);
  return { client, server };
}

afterAll(async () => {
  for (const pair of pairs) {
    await pair.client.close().catch(() => {});
    await pair.server.close().catch(() => {});
  }
});

describe("MCP integration (InMemory transport, real SDK)", () => {
  it("lists tools exposed by a server", async () => {
    const pair = await makePair();
    pairs.push(pair);
    const tools = await listMcpTools(pair.client);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["boom", "echo", "we ird/name!"]);
    const echo = tools.find((t) => t.name === "echo");
    expect(echo?.description).toBe("echo the message back");
    expect(echo?.inputSchema?.properties?.message).toBeDefined();
  });

  it("calls a tool and returns its text content", async () => {
    const pair = await makePair();
    pairs.push(pair);
    const text = await callMcpTool(pair.client, "echo", { message: "hello tau" });
    expect(text).toBe("echo: hello tau");
  });

  it("throws a readable error when the tool reports isError", async () => {
    const pair = await makePair();
    pairs.push(pair);
    await expect(callMcpTool(pair.client, "boom", {})).rejects.toThrow("kaboom reason");
  });

  it("maps discovered tools into medium-risk Tau definitions", async () => {
    const pair = await makePair();
    pairs.push(pair);
    const tools = await listMcpTools(pair.client);
    const defs = mcpToolsToDefinitions(plugin, tools);

    const echo = defs.find((d) => d.name === "plugin.mock.echo");
    expect(echo).toBeDefined();
    expect(echo?.risk).toBe("medium");
    expect(echo?.owner).toBe("plugin:mock");
    expect(echo?.description).toBe("[plugin:mock] echo the message back");
    expect(echo?.params.map((p) => p.name)).toEqual(["message"]);
    expect(defs.find((d) => d.name === "plugin.mock.we-ird-name")).toBeDefined();
  });
});

describe("MCP integration (real stdio transport, spawned server)", () => {
  it(
    "connects to a spawned MCP server, passes env, and runs tools end-to-end",
    { timeout: 20_000 },
    async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const { fileURLToPath } = await import("node:url");
      // The child resolves the SDK/zod from node_modules upward, so the
      // scratch dir must live INSIDE the owning package (packages/plugins/),
      // not in the OS tmpdir and not at the repo root — under pnpm's isolated
      // layout only this package's node_modules links the MCP SDK, and the
      // root vitest cwd cannot see it.
      const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
      const dir = fs.mkdtempSync(path.join(pkgRoot, ".tmp-mcp-e2e-"));
      try {
        await runStdioE2E(dir);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

async function runStdioE2E(dir: string): Promise<void> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const serverPath = path.join(dir, "server.mjs");
  fs.writeFileSync(
    serverPath,
    `import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
const server = new McpServer({ name: "e2e", version: "0.1.0" });
server.tool("envcheck", "return the env marker", {}, async () => ({
  content: [{ type: "text", text: process.env.TAU_PLUGIN_E2E ?? "missing" }],
}));
server.tool("greet", "greet someone", { who: z.string() }, async ({ who }) => ({
  content: [{ type: "text", text: \`hi \${who}\` }],
}));
await server.connect(new StdioServerTransport());
`,
  );

  const stdioPlugin: PluginConfig = {
    name: "e2e",
    transport: "stdio",
    command: process.execPath,
    args: [serverPath],
    env: { TAU_PLUGIN_E2E: "env-var-flows" },
  };

  const { connectPluginClient } = await import("../src/mcp.js");
  const sdk = await loadMcpSdk();
  expect(sdk).not.toBeNull();
  if (!sdk) return;

  const client = await connectPluginClient(sdk, stdioPlugin);
  const tools = await listMcpTools(client);
  expect(tools.map((t) => t.name).sort()).toEqual(["envcheck", "greet"]);
  await client.close().catch(() => {});

  const defs = mcpToolsToDefinitions(stdioPlugin, tools);
  const envcheck = defs.find((d) => d.name === "plugin.e2e.envcheck");
  expect(envcheck).toBeDefined();
  // run() opens a FRESH connection from the plugin config — this is the
  // exact path an AI plan step takes at execution time.
  const result = await envcheck!.run({});
  expect(result.text).toBe("env-var-flows");

  const greet = defs.find((d) => d.name === "plugin.e2e.greet");
  const greeted = await greet!.run({ who: "tau" });
  expect(greeted.text).toBe("hi tau");
}
