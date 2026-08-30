/**
 * Plugin runtime — loads every enabled plugin's tools into the registry with
 * per-plugin failure isolation: one broken server degrades to a warning and
 * never breaks the CLI or the other plugins.
 */

import { loadConfig } from "@tau/core";
import type { ToolDefinition } from "@tau/core";
import { registerTools } from "@tau/tools";
import {
  MCP_SDK_MISSING,
  connectPluginClient,
  listMcpTools,
  loadMcpSdk,
  mcpToolsToDefinitions,
} from "./mcp.js";

/**
 * Plugin runtime: connect configured MCP servers, discover their tools and
 * register them into Tau's tool registry so the AI planner catalog (and the
 * safety reviewer) sees them like any other tool.
 *
 * Failure policy: plugin problems NEVER break the CLI. Each failing plugin
 * becomes a warning; Tau continues with what it has. An absent MCP SDK
 * disables the whole subsystem the same way.
 */

export interface PluginLoadResult {
  tools: ToolDefinition[];
  warnings: string[];
}

/** Connect to every enabled plugin and collect their tool definitions. */
export async function loadPluginTools(): Promise<PluginLoadResult> {
  const config = loadConfig();
  const enabled = config.plugins.filter((p) => p.enabled !== false);
  if (enabled.length === 0) return { tools: [], warnings: [] };

  const sdk = await loadMcpSdk();
  if (!sdk) return { tools: [], warnings: [MCP_SDK_MISSING] };

  const tools: ToolDefinition[] = [];
  const warnings: string[] = [];
  for (const plugin of enabled) {
    let client;
    try {
      client = await connectPluginClient(sdk, plugin);
      const defs = mcpToolsToDefinitions(plugin, await listMcpTools(client));
      tools.push(...defs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`plugin "${plugin.name}" unavailable: ${message}`);
    } finally {
      await client?.close().catch(() => {});
    }
  }
  return { tools, warnings };
}

/**
 * Discover plugin tools and register them (idempotent via replace).
 * Returns the warnings for the caller to render.
 */
export async function registerPluginTools(): Promise<string[]> {
  const { tools, warnings } = await loadPluginTools();
  if (tools.length > 0) registerTools(tools, { replace: true });
  return warnings;
}
