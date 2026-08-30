/**
 * tau config — get/set/list persisted configuration.
 * Supports dotted provider keys (providers.<name>.<field>), validates values
 * (timeout positivity, opaque apiKeys) and masks secrets in every output.
 */

import type { Command } from "commander";
import { theme } from "../ui/theme.js";
import {
  DEFAULT_CONFIG,
  getConfigValue,
  loadConfig,
  maskSecret,
  redactConfig,
  saveConfig,
  setConfigValue,
} from "../config/store.js";
import { configPath, tauHome } from "../config/paths.js";
import { providerNames } from "../ai/registry.js";

export function registerConfigCommands(program: Command): void {
  const config = program
    .command("config")
    .description("View and change Tau configuration (stored under TAU_HOME)");

  config
    .command("get")
    .description("Get one config value (top-level keys or providers.<name>.<field>)")
    .argument("<key>", "e.g. provider | timeout | providers.deepseek.model")
    .action((key: string) => {
      try {
        const value = getConfigValue(key);
        // Secret hygiene: apiKey values are always masked on display.
        const masked =
          typeof value === "string" && (key === "apiKey" || key.endsWith(".apiKey"))
            ? maskSecret(value)
            : value;
        console.log(typeof masked === "string" ? masked : JSON.stringify(masked, null, 2));
      } catch (error) {
        console.error(theme.error((error as Error).message));
        process.exitCode = 1;
      }
    });

  config
    .command("set")
    .description("Set one config value (top-level keys or providers.<name>.<field>)")
    .argument("<key>", "key name, e.g. provider | providers.openai.model")
    .argument("<value>", "raw value (true/false/number/JSON)")
    .action((key: string, value: string) => {
      try {
        setConfigValue(key, value);
        console.log(
          theme.ok(
            `${key} = ${key.endsWith(".apiKey") || key === "apiKey" ? maskSecret(value) : value}`,
          ),
        );
      } catch (error) {
        console.error(theme.error((error as Error).message));
        process.exitCode = 1;
      }
    });

  config
    .command("list")
    .description("Show the effective config (API keys masked)")
    .action(() => {
      const effective = redactConfig(loadConfig());
      console.log(JSON.stringify(effective, null, 2));
      console.log(theme.muted(`\navailable providers: ${providerNames().join(", ")}`));
    });

  config
    .command("path")
    .description("Print where the config file lives")
    .action(() => {
      console.log(configPath());
      console.log(theme.muted(`TAU_HOME=${tauHome()}`));
    });

  config
    .command("reset")
    .description("Restore default config values")
    .action(() => {
      saveConfig(structuredClone(DEFAULT_CONFIG));
      console.log(theme.ok("Config restored to defaults."));
    });
}
