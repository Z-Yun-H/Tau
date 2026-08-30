/**
 * SafetyReviewer — the gate every AI-generated plan must pass.
 * DENY patterns block outright, CAUTION patterns force confirmation, risk is
 * the max of tool/self-assessed/pattern-derived levels; blocked steps are
 * never executed, only reported.
 */

import { RISK_ORDER } from "@tau/core";
import type { Plan, PlanStep, RiskLevel, SafetyIssue, SafetyReview } from "@tau/core";
import { getTool } from "@tau/tools";

/**
 * SafetyReviewer — the gate every AI-generated plan must pass.
 *
 * Principles (see docs/safety.md):
 * 1. Built-in tools are first-party code and safe by construction.
 * 2. Shell steps from AI plans are scanned against a deny list and a caution list.
 * 3. Blocked is blocked: nothing overrides it, not even --yes.
 * 4. The reviewer is deterministic and unit-tested; the AI never grades itself.
 */

/** Hard deny patterns — matching an AI shell step against these is an automatic deny. */
export const DENY_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)*\/(\s|$)/, // rm -rf /
  /\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+~/, // rm -r ~ variants
  /\bsudo\b/,
  /\bsu\s+\b/,
  /\bmkfs(\.\w+)?\b/,
  /\bdd\b[^|]*\bof=\/dev\//,
  />\s*\/dev\/(sd|nvme|hd)/,
  /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|fi)?sh\b/, // curl | sh
  /\bchmod\s+(-R\s+)?777\s+\/(\s|$)/,
  /:\(\)\s*\{.*\};\s*:/, // fork bomb
  /\b(shutdown|reboot|halt|poweroff)\b/,
  /\bmkswap\b/,
  /\bparted\b|\bfdisk\b/,
  /\bhistory\s+-c\b/,
  /\b(ssh-keygen\s+-R|known_hosts\s+>)\b/,
  /\bgit\s+push\s+.*--force\b/, // force push needs a human typing it
  /\bdrop\s+(table|database)\b/i,
];

/** Caution patterns — escalate risk to "high" (interactive confirm required). */
export const CAUTION_PATTERNS: RegExp[] = [
  /\brm\b/,
  /\bmv\b.*\/etc\//,
  /\bchown\b/,
  /\bchmod\b/,
  /\bkill\b|\bpkill\b|\bkillall\b/,
  /\bgit\s+(reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--\s)/,
  /\bnpm\s+(publish|uninstall)/,
  /\bpip\s+uninstall\b/,
  /\bcurl\b|\bwget\b/,
  />\s*\/(etc|usr|bin|sbin)\//,
  /\bdocker\s+(system\s+prune|rm|rmi)\b/,
  /\btruncate\b/,
  /\btee\s+\/etc\//,
];

const MAX_SHELL_LENGTH = 2000;

export function scanShellCommand(command: string): RiskLevel {
  if (command.length > MAX_SHELL_LENGTH) return "blocked";
  for (const pattern of DENY_PATTERNS) {
    if (pattern.test(command)) return "blocked";
  }
  for (const pattern of CAUTION_PATTERNS) {
    if (pattern.test(command)) return "high";
  }
  return "low";
}

function stepRisk(step: PlanStep, index: number): { risk: RiskLevel; issues: SafetyIssue[] } {
  const issues: SafetyIssue[] = [];
  if (step.kind === "shell") {
    const command = (step.command ?? "").trim();
    if (command.length === 0) {
      issues.push({ level: "blocked", message: "empty shell command", stepIndex: index });
      return { risk: "blocked", issues };
    }
    const risk = scanShellCommand(command);
    if (risk === "blocked") {
      issues.push({
        level: "blocked",
        message: `shell command matches deny list: ${command.slice(0, 120)}`,
        stepIndex: index,
      });
    } else if (risk === "high") {
      issues.push({
        level: "high",
        message: `caution: shell command touches risky operation: ${command.slice(0, 120)}`,
        stepIndex: index,
      });
    }
    return { risk, issues };
  }

  // Tool step: must reference a registered tool.
  const tool = step.tool ? getTool(step.tool) : undefined;
  if (!step.tool || !tool) {
    issues.push({
      level: "blocked",
      message: `unknown tool "${step.tool ?? "(missing)"}" — planner may only use registered tools`,
      stepIndex: index,
    });
    return { risk: "blocked", issues };
  }
  return { risk: tool.risk, issues };
}

export function reviewPlan(plan: Plan): SafetyReview {
  const issues: SafetyIssue[] = [];

  if (!plan.steps || plan.steps.length === 0) {
    issues.push({ level: "blocked", message: "plan contains no steps" });
  }
  if (plan.steps.length > 10) {
    issues.push({
      level: "blocked",
      message: `plan has ${plan.steps.length} steps (max 10) — likely runaway generation`,
    });
  }

  let overall = "low" as RiskLevel;
  plan.steps.forEach((step, index) => {
    const { risk, issues: stepIssues } = stepRisk(step, index);
    issues.push(...stepIssues);
    if (RISK_ORDER[risk] > RISK_ORDER[overall]) overall = risk;
  });
  // Re-annotate: assignments inside the forEach callback are invisible to CFA.
  const overallRisk: RiskLevel = overall;

  if (issues.some((issue) => issue.level === "blocked")) {
    return { verdict: "deny", overallRisk: "blocked", issues };
  }
  // Only fully-clean low-risk plans sail through; medium+ and any issue
  // (e.g. caution notes on low-risk steps) require the confirmation path.
  if (overallRisk === "low" && issues.length === 0) {
    return { verdict: "allow", overallRisk, issues };
  }
  return { verdict: "review", overallRisk, issues };
}
