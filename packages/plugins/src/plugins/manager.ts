import { loadConfig, saveConfig } from "@tau/core";
import type { PluginConfig } from "@tau/core";

/**
 * Plugin (MCP server) configuration management.
 * Pure config CRUD — no connections here. See mcp.ts for the live side.
 */

/** Reserved plugin names that would collide with built-in naming. */
const RESERVED_NAMES = new Set(["core", "plugin", "shell", "skill", "tau"]);

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

export function validatePluginName(name: string): void {
  if (name.length === 0 || name.length > 40) {
    throw new Error("Plugin name must be 1-40 characters.");
  }
  if (!NAME_PATTERN.test(name)) {
    throw new Error(`Plugin name "${name}" must be kebab-case (a-z, 0-9, dashes).`);
  }
  if (RESERVED_NAMES.has(name)) {
    throw new Error(`Plugin name "${name}" is reserved.`);
  }
}

/** Validate transport-specific fields; throws with a readable message. */
export function validatePlugin(plugin: PluginConfig): void {
  validatePluginName(plugin.name);
  if (plugin.transport === "stdio") {
    if (!plugin.command || plugin.command.trim().length === 0) {
      throw new Error(`Plugin "${plugin.name}" uses the stdio transport but has no command.`);
    }
  } else if (plugin.transport === "http") {
    if (!plugin.url) {
      throw new Error(`Plugin "${plugin.name}" uses the http transport but has no url.`);
    }
    let parsed: URL;
    try {
      parsed = new URL(plugin.url);
    } catch {
      throw new Error(`Plugin "${plugin.name}" has an invalid url: ${plugin.url}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`Plugin "${plugin.name}" url must be http(s): ${plugin.url}`);
    }
  } else {
    throw new Error(`Plugin "${plugin.name}" has unknown transport "${String(plugin.transport)}".`);
  }
}

function upsert(plugins: PluginConfig[], plugin: PluginConfig): void {
  const index = plugins.findIndex((p) => p.name === plugin.name);
  if (index === -1) plugins.push(plugin);
  else plugins[index] = plugin;
}

/** Add (or replace) a plugin in the persisted config. */
export function addPlugin(plugin: PluginConfig): void {
  validatePlugin(plugin);
  const config = loadConfig();
  upsert(config.plugins, plugin);
  saveConfig(config);
}

export function removePlugin(name: string): void {
  const config = loadConfig();
  const before = config.plugins.length;
  config.plugins = config.plugins.filter((p) => p.name !== name);
  if (config.plugins.length === before) {
    throw new Error(`No plugin named "${name}" is configured.`);
  }
  saveConfig(config);
}

export function setPluginEnabled(name: string, enabled: boolean): PluginConfig {
  const config = loadConfig();
  const plugin = config.plugins.find((p) => p.name === name);
  if (!plugin) throw new Error(`No plugin named "${name}" is configured.`);
  plugin.enabled = enabled;
  saveConfig(config);
  return plugin;
}

export function findPlugin(name: string): PluginConfig | undefined {
  return loadConfig().plugins.find((p) => p.name === name);
}

/** Endpoint summary for list output. */
export function pluginEndpoint(plugin: PluginConfig): string {
  return plugin.transport === "stdio"
    ? [plugin.command, ...(plugin.args ?? [])].join(" ")
    : (plugin.url ?? "");
}

export function listPluginsText(): string {
  const plugins = loadConfig().plugins;
  if (plugins.length === 0) {
    return [
      "No MCP plugins configured.",
      "",
      "Get started:",
      "  tau plugin add files -- npx -y @modelcontextprotocol/server-filesystem ./project",
      "  tau plugin add dsh --url http://127.0.0.1:8787/mcp",
      "",
      "See docs/plugins.md for dsh / VS Code recipes.",
    ].join("\n");
  }
  const lines = [`${plugins.length} plugin(s) configured:`, ""];
  for (const plugin of plugins) {
    const state = plugin.enabled === false ? "disabled" : "enabled";
    lines.push(`  ${plugin.name}  [${plugin.transport}] ${pluginEndpoint(plugin)}  (${state})`);
    if (plugin.description) lines.push(`    ${plugin.description}`);
  }
  lines.push("", "Connect and inspect: tau plugin tools <name>");
  return lines.join("\n");
}
