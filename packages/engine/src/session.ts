/**
 * runPlan — the ONLY execution channel for AI plans:
 * safety review -> user confirmation -> step execution -> history append.
 * Every AI-driven action in Tau flows through here; nothing bypasses it.
 */

import { theme } from "@tau/ui";
import { confirm } from "@tau/ui";
import { getTool } from "@tau/tools";
import { reviewPlan, scanShellCommand } from "./safety.js";
import { executeStep, type StepOutcome } from "./executor.js";
import { appendHistory, loadConfig } from "@tau/core";
import type { Plan, PlanEvent, RiskLevel, ShellPref } from "@tau/core";

/**
 * Session pipeline: plan -> safety review -> user confirmation -> execution -> history.
 * This is the single entry point through which ANY AI-generated plan is allowed
 * to touch the real world. Direct built-in tool commands skip confirm but still
 * write history.
 */

export interface RunPlanOptions {
  /** Provider name for history tracking. */
  provider?: string;
  /** Auto-approve low risk (medium only with allowMediumAutoApprove; never high/blocked). Used by --yes. */
  assumeYes: boolean;
  /** Allow --yes to cover medium risk steps too. */
  allowMediumAutoApprove: boolean;
  timeoutSec: number;
  /** Skip writing history (tests). */
  skipHistory?: boolean;
  /** Bypass interactive confirm (tests only — already-reviewed plans). */
  autoApproveAll?: boolean;
  /**
   * Optional lifecycle observer (streaming front doors). Absent = zero
   * behavior change; present = exactly one terminal plan_end event, always.
   */
  onEvent?: (event: PlanEvent) => void;
  /** Shell override for shell-steps (default: config `shell` → "auto"). */
  shell?: ShellPref;
}

export interface RunPlanResult {
  status: "ok" | "failed" | "cancelled" | "denied";
  review: ReturnType<typeof reviewPlan>;
  outcomes: StepOutcome[];
  output: string;
}

export function renderPlan(plan: Plan, overallRisk: RiskLevel): string {
  const lines: string[] = [];
  lines.push(
    theme.title("Plan") +
      theme.muted(`  (overall risk: `) +
      theme.risk(overallRisk) +
      theme.muted(")"),
  );
  lines.push(theme.info(plan.explanation));
  plan.steps.forEach((step, i) => {
    const what =
      step.kind === "tool"
        ? `tool ${theme.brand(step.tool ?? "?")} ${JSON.stringify(step.args ?? {})}`
        : `shell ${theme.warn(`$ ${step.command ?? ""}`)}`;
    lines.push(`  ${theme.muted(`${i + 1}.`)} ${what}`);
    if (step.reason) lines.push(`     ${theme.muted(step.reason)}`);
  });
  return lines.join("\n");
}

export function renderReview(plan: Plan): string {
  const review = reviewPlan(plan);
  const lines: string[] = [];
  if (review.issues.length > 0) {
    for (const issue of review.issues) {
      const tag = issue.level === "blocked" ? theme.error("BLOCKED") : theme.warn("CAUTION");
      const step = issue.stepIndex !== undefined ? `step ${issue.stepIndex + 1}: ` : "";
      lines.push(`${tag} ${step}${issue.message}`);
    }
  }
  return lines.join("\n");
}

export async function runPlan(
  intent: string,
  plan: Plan,
  options: RunPlanOptions,
): Promise<RunPlanResult> {
  const emit = options.onEvent ?? (() => {});
  const review = reviewPlan(plan);

  if (review.verdict === "deny") {
    if (!options.skipHistory) {
      appendHistory(intent, "plan", plan.steps, "denied", { provider: options.provider });
    }
    emit({ type: "plan_end", status: "denied" });
    return { status: "denied", review, outcomes: [], output: renderReview(plan) };
  }

  // ---- Confirmation ----
  const interactive = process.stdin.isTTY === true || options.autoApproveAll === true;
  let approveAll = options.autoApproveAll === true;
  if (!approveAll && !options.assumeYes) {
    if (!interactive) {
      emit({ type: "plan_end", status: "cancelled" });
      return {
        status: "cancelled",
        review,
        outcomes: [],
        output:
          "Non-interactive shell refuses to execute without --yes.\nRe-run with --yes to auto-approve low-risk steps (medium only with config allowMediumAutoApprove).",
      };
    }
    console.log(renderPlan(plan, review.overallRisk));
    const reviewText = renderReview(plan);
    if (reviewText) console.log(reviewText);
    const answer = await confirm("Run this plan? [y]es / [a]ll steps / [n]o");
    if (answer === "no") {
      if (!options.skipHistory) {
        appendHistory(intent, "plan", plan.steps, "cancelled", { provider: options.provider });
      }
      emit({ type: "plan_end", status: "cancelled" });
      return { status: "cancelled", review, outcomes: [], output: "(cancelled by user)" };
    }
    if (answer === "all") approveAll = true;
  }

  // ---- Execution ----
  const outcomes: StepOutcome[] = [];
  let ok = true;
  // Shell selection is config-driven (no new deps); POSIX `auto` keeps the
  // historical spawn(shell:true) behavior byte-identical.
  const shellPref = options.shell ?? loadConfig().shell ?? "auto";
  for (let i = 0; i < plan.steps.length; i++) {
    const step = plan.steps[i]!;

    // Per-step gate even after blanket approval.
    let allowed = true;
    if (!approveAll && !options.autoApproveAll) {
      const risk = stepRiskOf(step);
      if (options.assumeYes && risk === "high") {
        outcomes.push({
          ok: false,
          output: "(high risk step requires interactive approval)",
          skipped: true,
        });
        ok = false;
        emit({ type: "step_end", index: i, ok: false, skipped: true });
        continue;
      }
      if (options.assumeYes && risk === "medium" && !options.allowMediumAutoApprove) {
        console.log(renderPlanStep(i, step));
        const answer = await confirm(`Step ${i + 1} is medium risk — run it? [y]es / [n]o`);
        allowed = answer === "yes" || answer === "all";
      }
    }

    emit({ type: "step_start", index: i, step });
    const outcome = await executeStep(step, i, {
      timeoutSec: options.timeoutSec,
      gate: () => allowed,
      shell: shellPref,
      onOutput: (chunk) => emit({ type: "step_output", index: i, chunk }),
    });
    outcomes.push(outcome);
    emit({
      type: "step_end",
      index: i,
      ok: outcome.ok,
      exitCode: outcome.exitCode,
      skipped: outcome.skipped,
    });
    if (outcome.output && !outcome.skipped) {
      console.log(outcome.output);
    }
    if (!outcome.ok) {
      ok = false;
      console.error(theme.error(`Step ${i + 1} failed — stopping plan.`));
      break;
    }
  }

  const status: RunPlanResult["status"] = ok ? "ok" : "failed";
  if (!options.skipHistory) {
    appendHistory(intent, "plan", plan.steps, status, {
      exitCode: ok ? 0 : 1,
      provider: options.provider,
    });
  }
  emit({ type: "plan_end", status });
  return { status, review, outcomes, output: outcomes.map((o) => o.output).join("\n") };
}

function renderPlanStep(index: number, step: Plan["steps"][number]): string {
  const what =
    step.kind === "tool"
      ? `tool ${step.tool} ${JSON.stringify(step.args ?? {})}`
      : `shell $ ${step.command ?? ""}`;
  return `  ${theme.muted(`${index + 1}.`)} ${what}`;
}

function stepRiskOf(step: Plan["steps"][number]): RiskLevel {
  if (step.kind === "shell") {
    // Already reviewed; re-derive cheaply.
    return scanShellCommand(step.command ?? "");
  }
  // Tool steps carry the tool's INTRINSIC risk: the --yes policy (skip high,
  // confirm medium unless allowMediumAutoApprove) must treat a medium-risk
  // tool (file.rename, text.replace, plugin.* tools) differently from a
  // read-only one, exactly as reviewPlan did at the plan level.
  const tool = step.tool ? getTool(step.tool) : undefined;
  return tool ? tool.risk : "blocked";
}
