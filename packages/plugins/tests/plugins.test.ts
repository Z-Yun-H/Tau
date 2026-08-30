import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  addPlugin,
  listPluginsText,
  pluginEndpoint,
  removePlugin,
  setPluginEnabled,
  validatePlugin,
  validatePluginName,
} from "../src/manager.js";
import { jsonTypeToParamType, mcpResultToText, mcpToolsToDefinitions } from "../src/mcp.js";
import { loadConfig } from "@tau/core";
import type { PluginConfig } from "@tau/core";

let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-plugins-"));
  process.env.TAU_HOME = path.join(tmp, "home");
  fs.mkdirSync(path.join(tmp, "home"), { recursive: true });
});

afterEach(() => {
  delete process.env.TAU_HOME;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function stdioPlugin(overrides: Partial<PluginConfig> = {}): PluginConfig {
  return {
    name: "test-plugin",
    transport: "stdio",
    command: "node",
    args: ["server.mjs"],
    ...overrides,
  };
}

describe("plugin name validation", () => {
  it("accepts kebab-case names", () => {
    expect(() => validatePluginName("dsh")).not.toThrow();
    expect(() => validatePluginName("vscode-bridge")).not.toThrow();
    expect(() => validatePluginName("a1-b2")).not.toThrow();
  });

  it("rejects invalid and reserved names", () => {
    expect(() => validatePluginName("")).toThrow(/1-40/);
    expect(() => validatePluginName("Upper")).toThrow(/kebab-case/);
    expect(() => validatePluginName("has space")).toThrow(/kebab-case/);
    expect(() => validatePluginName("-lead")).toThrow(/kebab-case/);
    expect(() => validatePluginName("core")).toThrow(/reserved/);
    expect(() => validatePluginName("plugin")).toThrow(/reserved/);
  });
});

describe("plugin transport validation", () => {
  it("stdio requires a command", () => {
    expect(() => validatePlugin({ name: "x", transport: "stdio" })).toThrow(/no command/);
  });

  it("http requires a valid http(s) url", () => {
    expect(() => validatePlugin({ name: "x", transport: "http" })).toThrow(/no url/);
    expect(() => validatePlugin({ name: "x", transport: "http", url: "ftp://bad" })).toThrow(
      /http\(s\)/,
    );
    expect(() => validatePlugin({ name: "x", transport: "http", url: "not a url" })).toThrow(
      /invalid url/,
    );
    expect(() =>
      validatePlugin({ name: "x", transport: "http", url: "https://ok.example.com/mcp" }),
    ).not.toThrow();
  });

  it("rejects unknown transports", () => {
    expect(() =>
      validatePlugin({ name: "x", transport: "carrier-pigeon" as PluginConfig["transport"] }),
    ).toThrow(/unknown transport/);
  });
});

describe("plugin config CRUD", () => {
  it("persists, lists, toggles and removes plugins", () => {
    addPlugin(stdioPlugin({ description: "first" }));
    addPlugin({ name: "remote", transport: "http", url: "http://127.0.0.1:9999/mcp" });

    const config = loadConfig();
    expect(config.plugins).toHaveLength(2);
    expect(config.plugins[0]?.name).toBe("test-plugin");
    expect(config.plugins[1]?.name).toBe("remote");
    expect(config.plugins[1]?.url).toBe("http://127.0.0.1:9999/mcp");

    expect(pluginEndpoint(stdioPlugin())).toBe("node server.mjs");
    expect(listPluginsText()).toContain("2 plugin(s) configured");
    expect(listPluginsText()).toContain("test-plugin");
    expect(listPluginsText()).toContain("remote");

    // re-add replaces instead of duplicating
    addPlugin(stdioPlugin({ args: ["other.mjs"] }));
    expect(loadConfig().plugins).toHaveLength(2);
    expect(loadConfig().plugins[0]?.args).toEqual(["other.mjs"]);

    setPluginEnabled("remote", false);
    expect(loadConfig().plugins.find((p) => p.name === "remote")?.enabled).toBe(false);
    expect(listPluginsText()).toContain("disabled");

    setPluginEnabled("remote", true);
    expect(loadConfig().plugins.find((p) => p.name === "remote")?.enabled).toBe(true);

    removePlugin("remote");
    expect(loadConfig().plugins.map((p) => p.name)).toEqual(["test-plugin"]);
    expect(() => removePlugin("remote")).toThrow(/No plugin named/);
  });

  it("empty config renders onboarding guidance", () => {
    expect(listPluginsText()).toContain("No MCP plugins configured");
    expect(listPluginsText()).toContain("tau plugin add");
  });
});

describe("MCP tool mapping", () => {
  it("maps json schema types to Tau param specs", () => {
    expect(jsonTypeToParamType({ type: "string" })).toBe("string");
    expect(jsonTypeToParamType({ type: "integer" })).toBe("number");
    expect(jsonTypeToParamType({ type: "number" })).toBe("number");
    expect(jsonTypeToParamType({ type: "boolean" })).toBe("boolean");
    expect(jsonTypeToParamType({ type: "array" })).toBe("string[]");
    expect(jsonTypeToParamType({ type: "object" })).toBe("string");
    expect(jsonTypeToParamType({})).toBe("string");
  });

  it("converts MCP tool descriptors into always-medium-risk definitions", () => {
    const plugin = { name: "dsh", transport: "http" as const, url: "http://x/mcp" };
    const defs = mcpToolsToDefinitions(plugin, [
      {
        name: "profile.status",
        description: "Show dsh profile status",
        inputSchema: {
          type: "object",
          properties: {
            verbose: { type: "boolean", description: "extra detail" },
            limit: { type: "integer", default: 10 },
            tags: { type: "array" },
          },
          required: ["verbose"],
        },
      },
      { name: "we ird/name!" },
    ]);

    expect(defs).toHaveLength(2);
    const [first, second] = defs;
    expect(first?.name).toBe("plugin.dsh.profile-status");
    expect(first?.description).toBe("[plugin:dsh] Show dsh profile status");
    expect(first?.risk).toBe("medium");
    expect(first?.owner).toBe("plugin:dsh");

    const params = first?.params ?? [];
    expect(params.find((p) => p.name === "verbose")?.required).toBe(true);
    expect(params.find((p) => p.name === "verbose")?.type).toBe("boolean");
    expect(params.find((p) => p.name === "limit")?.default).toBe(10);
    expect(params.find((p) => p.name === "limit")?.required).toBe(false);
    expect(params.find((p) => p.name === "tags")?.type).toBe("string[]");

    expect(second?.name).toBe("plugin.dsh.we-ird-name");
    expect(second?.params).toEqual([]);
  });
});

describe("mcpResultToText", () => {
  it("joins text parts and omits binary content", () => {
    expect(
      mcpResultToText({
        content: [
          { type: "text", text: "a" },
          { type: "text", text: "b" },
        ],
      }),
    ).toBe("a\nb");
    expect(mcpResultToText({ content: [{ type: "image" }] })).toBe("(image content omitted)");
    expect(mcpResultToText({ content: [] })).toBe("(empty result)");
    expect(mcpResultToText({})).toBe("(empty result)");
  });
});
