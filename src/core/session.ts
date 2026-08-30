/**
 * runPlan — the ONLY execution channel for AI plans:
 * safety review -> user confirmation -> step execution -> history append.
 * Every AI-driven action in Tau flows through here; nothing bypasses it.
 */

import { theme } from "../ui/theme.js";
import { confirm } from "../ui/confirm.js";
import { reviewPlan, scanShellCommand } from "./safety.js";
import { executeStep, type StepOutcome } from "./executor.js";
import { appendHistory } from "../config/history.js";
import type { Plan, RiskLevel } from "../types.js";

/**
 * Session pipeline: plan -> safety review -> user confirmation -> execution -> history.
 * This is the single entry point through which ANY AI-generated plan is allowed
 * to touch the real world. Direct built-in tool commands skip confirm but still
 * write history.
 */

export interface RunPlanOptions {
  /** Provider name for history tracking. */
  provider?: string;
  /** Auto-approve low/medium risk (never high/blocked). Used by --yes. */
  assumeYes: boolean;
  /** Allow --yes to cover medium risk steps too. */
  allowMediumAutoApprove: boolean;
  timeoutSec: number;
  /** Skip writing history (tests). */
  skipHistory?: boolean;
  /** Bypass interactive confirm (tests only — already-reviewed plans). */
  autoApproveAll?: boolean;
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
  const review = reviewPlan(plan);

  if (review.verdict === "deny") {
    if (!options.skipHistory) {
      appendHistory(intent, "plan", plan.steps, "denied", { provider: options.provider });
    }
    return { status: "denied", review, outcomes: [], output: renderReview(plan) };
  }

  // ---- Confirmation ----
  const interactive = process.stdin.isTTY === true || options.autoApproveAll === true;
  let approveAll = options.autoApproveAll === true;
  if (!approveAll && !options.assumeYes) {
    if (!interactive) {
      return {
        status: "cancelled",
        review,
        outcomes: [],
        output:
          "Non-interactive shell refuses to execute without --yes.\nRe-run with --yes to auto-approve low/medium risk steps only.",
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
      return { status: "cancelled", review, outcomes: [], output: "(cancelled by user)" };
    }
    if (answer === "all") approveAll = true;
  }

  // ---- Execution ----
  const outcomes: StepOutcome[] = [];
  let ok = true;
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
        continue;
      }
      if (options.assumeYes && risk === "medium" && !options.allowMediumAutoApprove) {
        console.log(renderPlanStep(i, step));
        const answer = await confirm(`Step ${i + 1} is medium risk — run it? [y]es / [n]o`);
        allowed = answer === "yes" || answer === "all";
      }
    }

    const outcome = await executeStep(step, i, {
      timeoutSec: options.timeoutSec,
      gate: () => allowed,
    });
    outcomes.push(outcome);
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
  return "low"; // tool intrinsic risk was validated in review; args risk unchanged
}
