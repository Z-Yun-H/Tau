#!/usr/bin/env node
/**
 * Tau CLI entry point.
 *
 * Command map (also documented in AGENTS.md):
 *   tau ask <intent...>        natural language -> AI plan -> review -> confirm -> run
 *   tau file <find|stat|tree|rename>
 *   tau sys  <info|disk|proc>
 *   tau net  <port|ping|fetch|ip>
 *   tau text <search|replace|count>
 *   tau skill <list|show|new|validate>
 *   tau history <list|show|replay|clear>
 *   tau alias  <list|add|remove>
 *   tau provider <list|set-key|models|use>
 *   tau config <get|set|list|path>
 *   tau plugin <list|add|remove|enable|disable|tools>
 *   tau tui                    hand off to the interactive terminal session (@tau/tui)
 *   tau web                    serve the local web UI (@tau/webui)
 *
 * (Line 1 is the #!/usr/bin/env node shebang; tsdown preserves it in the
 * bundle and marks the output executable.)
 */
import { Command } from "commander";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { registerCoreTools, registerTools, resetRegistry } from "@tau/tools";
import { scanSkills } from "@tau/skills";
import { buildSkillTools } from "@tau/agent";
import { registerTuiCommand } from "@tau/tui";
import { registerWebCommand } from "@tau/webui";
import { registerAsk } from "./ask.js";
import { registerFileCommands } from "./file.js";
import { registerSysCommands } from "./sys.js";
import { registerNetCommands } from "./net.js";
import { registerTextCommands } from "./text.js";
import { registerSkillCommands } from "./skill.js";
import { registerHistoryCommands } from "./history.js";
import { registerAliasCommands, expandAliasArgv } from "./alias.js";
import { registerProviderCommands } from "./provider.js";
import { registerConfigCommands } from "./config.js";
import { registerPluginCommands } from "./plugin.js";

const require = createRequire(import.meta.url);

export function readVersion(): string {
  try {
    return (require("../package.json") as { version: string }).version;
  } catch {
    return "0.0.0-dev";
  }
}

/**
 * Build the full CLI program.
 * Registered tool catalog = core tools + declarative commands from loaded skills,
 * so the AI planner automatically sees what skills contribute.
 */
export function buildProgram(): Command {
  // Rebuildable: tests and repeated main() calls start from a clean registry.
  resetRegistry();
  registerCoreTools();

  // Declarative commands from loaded skills join the registry, so the AI
  // planner automatically sees what skills contribute.
  const skillTools = buildSkillTools(scanSkills().skills);
  if (skillTools.length > 0) registerTools(skillTools);

  const program = new Command();
  program
    .name("tau")
    .description("AI-powered unified terminal assistant — natural language in, safe commands out.")
    .version(readVersion())
    .option("--provider <name>", "AI provider for this run (mock|ollama|openai|deepseek|zai)")
    .option("--yes", "auto-approve low/medium risk steps (never high/blocked)")
    .option("--json", "machine-readable output where supported");

  registerAsk(program);
  registerFileCommands(program);
  registerSysCommands(program);
  registerNetCommands(program);
  registerTextCommands(program);
  registerSkillCommands(program);
  registerHistoryCommands(program);
  registerAliasCommands(program);
  registerProviderCommands(program);
  registerConfigCommands(program);
  registerPluginCommands(program);
  registerTuiCommand(program);
  registerWebCommand(program);

  return program;
}

/** Run the CLI. Exported for tests. */
export async function main(inputArgv = process.argv): Promise<void> {
  // Alias expansion happens before commander sees the argv (tau ll -> tau file find ...).
  const argv = expandAliasArgv(inputArgv);
  const program = buildProgram();
  await program.parseAsync(argv, { from: "node" });
}

// Only auto-run when executed directly (not when imported by tests).
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((error) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  });
}
