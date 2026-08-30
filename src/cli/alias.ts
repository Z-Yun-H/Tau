/**
 * tau alias — short names for longer commands.
 * expandAliasArgv rewrites argv BEFORE commander parses (src/index.ts), so
 * aliases work for every command family; CRUD persists into config.aliases.
 */

import type { Command } from "commander";
import { theme } from "../ui/theme.js";
import { loadConfig, saveConfig } from "../config/store.js";

/**
 * Alias resolution happens BEFORE commander parses argv (see src/index.ts):
 *   tau ll            ->  tau file find
 *   tau grep TODO     ->  tau text search TODO
 * Aliases are stored in config.aliases as string arrays.
 */
export function expandAliasArgv(argv: string[]): string[] {
  const config = loadConfig();
  const rest = argv.slice(2);
  if (rest.length === 0) return argv;
  const head = rest[0] ?? "";
  const expansion = config.aliases[head];
  if (!expansion || expansion.length === 0) return argv;
  return [argv[0] ?? "tau", argv[1] ?? "", ...expansion, ...rest.slice(1)];
}

export function registerAliasCommands(program: Command): void {
  const alias = program
    .command("alias")
    .description("Manage command aliases stored in your Tau config");

  alias
    .command("list")
    .description("Show all aliases")
    .action(() => {
      const aliases = loadConfig().aliases;
      const names = Object.keys(aliases).sort();
      if (names.length === 0) {
        console.log(
          theme.muted("(no aliases yet — add one: tau alias add ll 'file' 'find' '*.ts')"),
        );
        return;
      }
      for (const name of names) {
        console.log(`  ${theme.brand(name.padEnd(16))} -> tau ${aliases[name]?.join(" ")}`);
      }
    });

  alias
    .command("add")
    .description("Add an alias: tau alias add <name> <command words...>")
    .argument("<name>", "alias name")
    .argument("<words...>", "command words to expand to")
    .action((name: string, words: string[]) => {
      const config = loadConfig();
      config.aliases[name] = words;
      saveConfig(config);
      console.log(theme.ok(`alias ${name} -> tau ${words.join(" ")}`));
    });

  alias
    .command("remove")
    .description("Remove an alias")
    .argument("<name>", "alias name")
    .action((name: string) => {
      const config = loadConfig();
      if (!config.aliases[name]) {
        console.error(theme.error(`No alias named "${name}"`));
        process.exitCode = 1;
        return;
      }
      delete config.aliases[name];
      saveConfig(config);
      console.log(theme.ok(`removed alias "${name}"`));
    });
}
