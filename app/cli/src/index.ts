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
 * Startup cost policy: this module (and every statically imported family)
 * must stay LIGHT — `tau --version`, `--help` and each light command never
 * pay for the AI/zod/engine chain. Anything that pulls `@tau/ai`, `@tau/agent`
 * or `@tau/webui` loads lazily inside its action (ask, provider via its
 * module-level `ai()` accessor, tui, web). The skills catalog scan moved to
 * the paths that actually need it (ask; TUI/WebUI call ensureCatalog()).
 *
 * (Line 1 is the #!/usr/bin/env node shebang; tsdown preserves it in the
 * bundle and marks the output executable.)
 */
import { Command } from "commander";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import { registerCoreTools, resetRegistry } from "@tau/tools";
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
import { registerWebCommand } from "./web.js";

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
 *
 * Core tools register up front (cheap, in-memory). Skill-contributed tools
 * register lazily where plans can execute them — `runAsk` registers them
 * after its scan; TUI/WebUI get them via @tau/agent's ensureCatalog().
 */
export function buildProgram(): Command {
  // Rebuildable: tests and repeated main() calls start from a clean registry.
  resetRegistry();
  registerCoreTools();

  const program = new Command();
  program
    .name("tau")
    .description("AI-powered unified terminal assistant — natural language in, safe commands out.")
    .version(readVersion())
    .option("--provider <name>", "AI provider for this run (mock|ollama|openai|deepseek|zai)")
    .option(
      "--yes",
      "auto-approve low-risk steps (medium needs config allowMediumAutoApprove; never high/blocked)",
    )
    .option("--json", "machine-readable output where supported");

  // Lazy: the ask action pulls the AI planning chain (providers, skills scan,
  // engine) only when actually invoked.
  program
    .command("ask")
    .description("Turn a natural-language intent into a reviewed, confirmed execution plan")
    .argument("<intent...>", "what you want, in plain words (Chinese or English)")
    .option("--explain", "print the planning context (tool catalog prompt) and exit")
    .action(async (intentParts: string[], options: { explain?: boolean }, command) => {
      const { runAsk } = await import("./ask.js");
      await runAsk(intentParts, options, command);
    });

  // Light families: their module graph is cheap (commander + @tau/ui + core).
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

  // Lazy: hands off to the interactive session (whole agent chain loads here).
  program
    .command("tui")
    .description("Start an interactive terminal session (REPL)")
    .action(async () => {
      const { startTui } = await import("@tau/tui");
      await startTui();
    });

  // Registration is light; @tau/webui itself loads inside the action.
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
// Installed bins run through a symlink (npm/pnpm .bin, `pnpm link`), so
// argv[1] must be resolved to its realpath before comparing against
// import.meta.url (Node ESM reports this module under its real path).
const invokedDirectly = (() => {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main().catch((error) => {
    console.error((error as Error).message);
    process.exitCode = 1;
  });
}
