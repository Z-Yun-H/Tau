/**
 * tau plugin — MCP server management.
 * list/add/remove/enable/disable plus `tools` to connect to a server and
 * discover what it exposes; plugin tools always register as medium risk.
 */

import type { Command } from "commander";
import { theme } from "@tau/ui";
import { loadConfig } from "@tau/core";
import {
  addPlugin,
  findPlugin,
  listPluginsText,
  pluginEndpoint,
  removePlugin,
  setPluginEnabled,
} from "@tau/plugins";
import {
  connectPluginClient,
  listMcpTools,
  loadMcpSdk,
  mcpToolsToDefinitions,
  MCP_SDK_MISSING,
} from "@tau/plugins";
import { globalOptions } from "./util.js";
import type { PluginConfig } from "@tau/core";

/**
 * tau plugin — manage MCP servers whose tools join the AI planner catalog.
 * Config-only operations are sync; `tools` connects live to verify.
 */
export function registerPluginCommands(program: Command): void {
  const plugin = program
    .command("plugin")
    .description("Manage MCP plugins (external tool servers: dsh, VS Code, filesystem, ...)");

  plugin
    .command("list")
    .description("List configured MCP plugins")
    .action((_opts, command) => {
      const { json } = globalOptions(command);
      if (json) {
        console.log(JSON.stringify(loadConfig().plugins, null, 2));
      } else {
        console.log(listPluginsText());
      }
    });

  plugin
    .command("add")
    .description(
      "Register a plugin: `tau plugin add <name> -- <command...>` (stdio) or `--url <endpoint>` (http)",
    )
    .argument("<name>", "kebab-case plugin alias")
    .argument("[command...]", "stdio server command (everything after --)")
    .option("--url <url>", "http transport: MCP Streamable HTTP endpoint")
    .option("--desc <text>", "human description")
    .option("--cwd <dir>", "stdio transport: working directory")
    .option("--env <key=value>", "stdio transport: extra env var (repeatable)", collectPairs)
    .option("--header <key=value>", "http transport: request header (repeatable)", collectPairs)
    .option("--disabled", "register but do not connect until enabled")
    .action(
      async (
        name: string,
        commandParts: string[],
        options: {
          url?: string;
          desc?: string;
          cwd?: string;
          env?: Record<string, string>;
          header?: Record<string, string>;
          disabled?: boolean;
        },
      ) => {
        try {
          const spec: PluginConfig = buildSpec(name, commandParts, options);
          addPlugin(spec);
          console.log(
            theme.ok(
              `plugin "${spec.name}" saved (${spec.transport}: ${pluginEndpoint(spec)})` +
                (spec.enabled === false ? " — disabled" : ""),
            ),
          );
          console.log(theme.muted("Inspect its tools with: tau plugin tools " + spec.name));
        } catch (error) {
          console.error(theme.error(error instanceof Error ? error.message : String(error)));
          process.exitCode = 1;
        }
      },
    );

  plugin
    .command("remove")
    .description("Remove a configured plugin")
    .argument("<name>", "plugin alias")
    .action((name: string) => {
      try {
        removePlugin(name);
        console.log(theme.ok(`plugin "${name}" removed.`));
      } catch (error) {
        console.error(theme.error(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
      }
    });

  plugin
    .command("enable")
    .description("Enable a plugin (it connects on the next ask)")
    .argument("<name>", "plugin alias")
    .action((name: string) => {
      try {
        setPluginEnabled(name, true);
        console.log(theme.ok(`plugin "${name}" enabled.`));
      } catch (error) {
        console.error(theme.error(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
      }
    });

  plugin
    .command("disable")
    .description("Disable a plugin (stays configured, never connects)")
    .argument("<name>", "plugin alias")
    .action((name: string) => {
      try {
        setPluginEnabled(name, false);
        console.log(theme.ok(`plugin "${name}" disabled.`));
      } catch (error) {
        console.error(theme.error(error instanceof Error ? error.message : String(error)));
        process.exitCode = 1;
      }
    });

  plugin
    .command("tools")
    .description("Connect to a plugin and list the tools it exposes")
    .argument("<name>", "plugin alias")
    .action(async (name: string) => {
      const config = findPlugin(name);
      if (!config) {
        console.error(theme.error(`No plugin named "${name}" is configured.`));
        process.exitCode = 1;
        return;
      }
      const sdk = await loadMcpSdk();
      if (!sdk) {
        console.error(theme.error(MCP_SDK_MISSING));
        process.exitCode = 1;
        return;
      }
      try {
        const client = await connectPluginClient(sdk, config);
        try {
          const defs = mcpToolsToDefinitions(config, await listMcpTools(client));
          if (defs.length === 0) {
            console.log(`plugin "${name}" exposes no tools.`);
            return;
          }
          console.log(`plugin "${name}" exposes ${defs.length} tool(s):`);
          for (const def of defs) {
            const params = def.params
              .map((p) => `${p.name}${p.required ? "" : "?"}:${p.type}`)
              .join(", ");
            console.log(`  ${theme.brand(def.name)} [risk:${def.risk}] ${def.description}`);
            console.log(`    params: (${params || "none"})`);
          }
        } finally {
          await client.close().catch(() => {});
        }
      } catch (error) {
        console.error(
          theme.error(
            `plugin "${name}" failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
        process.exitCode = 1;
      }
    });
}

function buildSpec(
  name: string,
  commandParts: string[],
  options: {
    url?: string;
    desc?: string;
    cwd?: string;
    env?: Record<string, string>;
    header?: Record<string, string>;
    disabled?: boolean;
  },
): PluginConfig {
  const hasCommand = commandParts.length > 0;
  if (hasCommand && options.url) {
    throw new Error("Choose one transport: a command after -- (stdio) OR --url (http), not both.");
  }
  if (hasCommand) {
    return {
      name,
      transport: "stdio",
      command: commandParts[0] ?? "",
      args: commandParts.slice(1),
      cwd: options.cwd,
      env: options.env,
      enabled: !options.disabled,
      description: options.desc,
    };
  }
  if (options.url) {
    if (options.cwd || options.env) {
      throw new Error("--cwd/--env only apply to the stdio transport.");
    }
    return {
      name,
      transport: "http",
      url: options.url,
      headers: options.header,
      enabled: !options.disabled,
      description: options.desc,
    };
  }
  throw new Error(
    'Nothing to connect: pass a command after "--" (stdio) or --url <endpoint> (http). Example: tau plugin add files -- npx -y @modelcontextprotocol/server-filesystem .',
  );
}

function collectPairs(
  value: string,
  previous: Record<string, string> = {},
): Record<string, string> {
  const eq = value.indexOf("=");
  if (eq <= 0) {
    throw new Error(`expected KEY=VALUE, got "${value}"`);
  }
  previous[value.slice(0, eq)] = value.slice(eq + 1);
  return previous;
}
