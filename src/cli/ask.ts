import type { Command } from "commander";
import { theme } from "../ui/theme.js";
import { resolveProvider } from "../ai/registry.js";
import { buildSystemPrompt, planningContext } from "../ai/prompt.js";
import { scanSkills, renderSkillCatalog } from "../skills/loader.js";
import { runPlan } from "../core/session.js";
import { globalOptions, timeoutSec } from "./util.js";
import { loadConfig } from "../config/store.js";

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
            "Tip: start with the offline mock (tau config set provider mock), or configure a real provider — see README > AI providers.",
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
