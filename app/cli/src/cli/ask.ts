/**
 * tau ask — the natural-language front door.
 * Resolves the provider, injects the skill catalog + plugin tools into the
 * planning context, then funnels everything through runPlan (the only plan
 * execution channel). --explain shows the plan without running it.
 */

import type { Command } from "commander";
import { theme } from "@tau/ui";
import { resolveProvider } from "@tau/ai";
import { buildSystemPrompt, planningContext } from "@tau/ai";
import { scanSkills, renderSkillCatalog } from "@tau/skills";
import { runPlan } from "@tau/engine";
import { registerPluginTools } from "@tau/plugins";
import { globalOptions, timeoutSec } from "./util.js";
import { loadConfig } from "@tau/core";

/**
 * tau ask — the AI front door.
 * Natural language -> provider plan -> deterministic safety review ->
 * interactive confirm -> execution -> history.
 */
export function registerAsk(program: Command): void {
  program
    .command("ask")
    .description("Turn a natural-language intent into a reviewed, confirmed execution plan")
    .argument("<intent...>", "what you want, in plain words (Chinese or English)")
    .option("--explain", "print the planning context (tool catalog prompt) and exit")
    .action(async (intentParts: string[], options: { explain?: boolean }, command) => {
      const intent = intentParts.join(" ").trim();
      const globals = globalOptions(command);

      const scan = scanSkills();

      // MCP plugin tools join the catalog before planning; failures degrade
      // to warnings so an unreachable server never blocks the CLI.
      for (const warning of await registerPluginTools()) {
        console.log(theme.warn(`plugin: ${warning}`));
      }

      const ctx = planningContext(intent, renderSkillCatalog(scan.skills));

      if (options.explain) {
        console.log(buildSystemPrompt(ctx));
        return;
      }

      const choice = resolveProvider(globals.provider);
      const available = await choice.provider.isAvailable();
      if (!available) {
        console.error(
          theme.error(`Provider "${choice.provider.name}" is not available.`),
          choice.provider.unavailableReason?.() ?? "",
        );
        console.error(
          theme.muted(
            "Tip: configure a key with `tau provider set-key <provider> <key>`, then pick a model with `tau provider use <provider>` — the model catalog refreshes automatically; or stay offline with `tau config set provider mock`.",
          ),
        );
        process.exitCode = 1;
        return;
      }

      const config = loadConfig();
      console.log(
        theme.muted(
          `planning with ${choice.provider.label} (${choice.source}) — risk gate is independent of the AI`,
        ),
      );

      try {
        const plan = await choice.provider.plan(ctx);
        const result = await runPlan(intent, plan, {
          provider: choice.provider.name,
          assumeYes: globals.yes,
          allowMediumAutoApprove: config.allowMediumAutoApprove,
          timeoutSec: timeoutSec(),
        });
        if (result.status !== "ok") {
          process.exitCode = result.status === "denied" ? 2 : 1;
          if (result.status === "denied") {
            console.error(theme.error("Plan denied by safety review:"));
            console.error(result.output);
          }
        }
      } catch (error) {
        console.error(
          theme.error(`Planning failed: ${error instanceof Error ? error.message : String(error)}`),
        );
        process.exitCode = 1;
      }
    });
}
