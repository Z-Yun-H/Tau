/**
 * tau goal — the multi-round agent front door.
 * One intent, up to N reviewed rounds: plan -> review -> confirm -> run ->
 * reflect -> repeat until the provider answers "done". Every round still
 * goes through runPlan() (the only execution channel); --rounds caps the
 * loop (default 3, hard ceiling 5); --yes keeps its exact ask semantics.
 *
 * LAZY: pulls the same @tau/ai + @tau/skills + @tau/engine + @tau/plugins
 * graph as runAsk — only loads when `tau goal` actually runs.
 */

import type { Command } from "commander";
import { theme } from "@tau/ui";
import { registerTools } from "@tau/tools";
import { buildSkillTools, runGoal, DEFAULT_MAX_ROUNDS, type GoalEvent } from "@tau/agent";
import { scanSkills } from "@tau/skills";
import { registerPluginTools } from "@tau/plugins";
import { globalOptions, timeoutSec } from "./util.js";
import { loadConfig } from "@tau/core";

/** Human-readable round header (CLI prints lifecycle, runPlan prints steps). */
function renderGoalEvent(event: GoalEvent): void {
  switch (event.type) {
    case "round_plan": {
      const tag = event.origin === "plan" ? "plan" : `round ${event.round} (AI continuation)`;
      const risk = event.review.overallRisk;
      console.log(
        theme.title(`Round ${event.round}`) + theme.muted(`  ${tag} · risk: `) + theme.risk(risk),
      );
      console.log(theme.muted(event.plan.explanation));
      return;
    }
    case "round_end":
      console.log(
        event.status === "ok"
          ? theme.muted(`— round ${event.round} finished ok —`)
          : theme.warn(`— round ${event.round} finished ${event.status} —`),
      );
      return;
    case "approval_required":
      console.log(theme.warn(`round ${event.round} is not low-risk — confirm below to continue`));
      return;
    default:
      return; // goal_start/goal_end render at the call site with full context
  }
}

/**
 * tau goal — multi-round agent loop over the same reviewed pipeline.
 */
export async function runGoalCli(
  intentParts: string[],
  options: { rounds?: string },
  command: Command,
): Promise<void> {
  const intent = intentParts.join(" ").trim();
  const globals = globalOptions(command);
  const config = loadConfig();

  // Same catalog bootstrap as runAsk: skill + plugin tools join the registry
  // before planning so every round can resolve them.
  const scan = scanSkills();
  const skillTools = buildSkillTools(scan.skills);
  if (skillTools.length > 0) registerTools(skillTools);
  for (const warning of await registerPluginTools()) {
    console.log(theme.warn(`plugin: ${warning}`));
  }

  const requested = options.rounds === undefined ? DEFAULT_MAX_ROUNDS : Number(options.rounds);
  const rounds = Number.isFinite(requested) ? requested : DEFAULT_MAX_ROUNDS;

  console.log(
    theme.muted(
      `goal loop (max ${rounds} rounds) — every round passes the same safety review as tau ask`,
    ),
  );

  const result = await runGoal(intent, {
    provider: globals.provider,
    maxRounds: rounds,
    assumeYes: globals.yes,
    allowMediumAutoApprove: config.allowMediumAutoApprove,
    timeoutSec: timeoutSec(),
    onGoalEvent: renderGoalEvent,
  });

  if (result.status === "ok" && result.answer) {
    console.log(theme.title("Answer") + theme.muted("  goal complete"));
    console.log(result.answer);
    return;
  }
  if (result.status === "max_rounds") {
    console.error(theme.warn(result.error ?? "goal hit the round cap"));
    console.error(theme.muted("Re-run with a higher --rounds or split the intent."));
    process.exitCode = 1;
    return;
  }
  if (result.status === "denied") {
    console.error(theme.error("Goal stopped — safety review denied a continuation round:"));
    console.error(result.error ?? "");
    process.exitCode = 2;
    return;
  }
  if (result.status === "cancelled") {
    console.log(theme.muted("Goal cancelled — nothing further was run."));
    return;
  }
  // failed
  console.error(theme.error(`Goal failed: ${result.error ?? "round failed — see output above"}`));
  process.exitCode = 1;
}
