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
 *   tau config <get|set|list|path>
 *
 * (The #!/usr/bin/env node shebang is added by tsup banner at build time.)
 */
import { Command } from "commander";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { registerCoreTools } from "./tools/index.js";
import { registerTools, resetRegistry } from "./tools/registry.js";
import { scanSkills } from "./skills/loader.js";
import type { ToolDefinition } from "./types.js";
import { registerAsk } from "./cli/ask.js";
import { registerFileCommands } from "./cli/file.js";
import { registerSysCommands } from "./cli/sys.js";
import { registerNetCommands } from "./cli/net.js";
import { registerTextCommands } from "./cli/text.js";
import { registerSkillCommands } from "./cli/skill.js";
import { registerHistoryCommands } from "./cli/history.js";
import { registerAliasCommands, expandAliasArgv } from "./cli/alias.js";
import { registerConfigCommands } from "./cli/config.js";

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

  const scan = scanSkills();
  const skillTools: ToolDefinition[] = [];
  for (const skill of scan.skills) {
    for (const command of skill.commands) {
      skillTools.push({
        name: `${skill.name}.${command.name}`,
        description: `[skill:${skill.name}] ${command.description}`,
        params: [],
        risk: command.risk ?? "low",
        owner: skill.name,
        run: async (args) => {
          // {args} placeholders are filled positionally from args.values.
          const values = Array.isArray(args["values"]) ? (args["values"] as string[]) : [];
          let cmd = command.command;
          let idx = 0;
          while (cmd.includes("{args}")) {
            cmd = cmd.replace("{args}", values[idx] ?? "");
            idx++;
          }
          const { runShell } = await import("./core/executor.js");
          const outcome = await runShell(cmd, { timeoutSec: 30 });
          return { text: outcome.output || `(exit ${outcome.exitCode})`, data: outcome };
        },
      });
    }
  }
  if (skillTools.length > 0) registerTools(skillTools);

  const program = new Command();
  program
    .name("tau")
    .description("AI-powered unified terminal assistant — natural language in, safe commands out.")
    .version(readVersion())
    .option("--provider <name>", "AI provider for this run (mock|ollama|openai|zai)")
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
  registerConfigCommands(program);

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
