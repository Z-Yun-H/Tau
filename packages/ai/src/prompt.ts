/**
 * Prompt construction + AI-plan validation.
 * Builds the system prompt from the live tool registry, sends it through the
 * provider, and parses the reply with a zod-strict Plan schema (markdown
 * fences tolerated, malformed plans rejected).
 */

import { z } from "zod";
import { renderToolCatalog, catalogSummary, allTools } from "@tau/tools";
import type { PlanningContext, Plan } from "@tau/core";

/**
 * Prompt construction + plan validation.
 * The AI must answer with STRICT JSON matching planSchema; anything else is
 * rejected before it can reach the safety reviewer.
 */

export const planStepSchema = z
  .object({
    kind: z.enum(["tool", "shell"]),
    tool: z.string().optional(),
    command: z.string().optional(),
    args: z.record(z.string(), z.unknown()).optional(),
    reason: z.string().optional(),
  })
  .strict();

export const planSchema = z
  .object({
    explanation: z.string().min(1),
    steps: z.array(planStepSchema).min(1).max(10),
    selfAssessedRisk: z.enum(["low", "medium", "high", "blocked"]).optional(),
  })
  .strict();

export type RawPlan = z.infer<typeof planSchema>;

/** Parse+validate a provider response. Throws with a readable message on failure. */
export function validatePlanResponse(raw: string): Plan {
  let jsonText = raw.trim();

  // Tolerate markdown code fences some models add.
  const fence = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) jsonText = fence[1].trim();

  // Tolerate leading prose before the first {.
  const start = jsonText.indexOf("{");
  const end = jsonText.lastIndexOf("}");
  if (start > 0 || (end !== -1 && end < jsonText.length - 1)) {
    if (start !== -1 && end > start) jsonText = jsonText.slice(start, end + 1);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonText);
  } catch {
    throw new Error("Provider did not return valid JSON — refusing to continue.");
  }
  const result = planSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new Error(
      `Plan failed schema validation: ${result.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  const rawPlan = result.data;
  return {
    explanation: rawPlan.explanation,
    steps: rawPlan.steps.map((step) => ({
      kind: step.kind,
      tool: step.tool,
      command: step.command,
      args: step.args,
      reason: step.reason ?? "",
    })),
    selfAssessedRisk: rawPlan.selfAssessedRisk,
  };
}

export function buildSystemPrompt(ctx: PlanningContext): string {
  return `You are Tau, a terminal command planner. You translate the user's intent into a SAFE execution plan.

RULES:
1. PREFER registered tools over raw shell commands. Tools are validated, cross-platform and safe.
2. Only use tools from the catalog below. Never invent tool names.
3. Use kind:"shell" ONLY when no tool fits. Never use shell for destructive operations (delete, format, sudo, piping installers).
4. Prefer DRY-RUN modes: tools tagged [dry-run-default] (file.rename, text.replace) accept execute:false. Plan the dry run first; the user can rerun with execute.
5. Prefer READ-ONLY tools (no [mutates] tag) for inspection. Reach for mutating tools only when the intent clearly asks for a change.
6. Answer with STRICT JSON only, no markdown, matching exactly:
{"explanation": string, "steps": [{"kind":"tool"|"shell", "tool"?: string, "args"?: object, "command"?: string, "reason": string}], "selfAssessedRisk": "low"|"medium"|"high"}
7. Max 10 steps. Each step needs a short "reason".
8. If the intent is unclear or impossible, still return JSON with a single shell step: echo an explanation.

CATALOG SUMMARY: ${catalogSummary()}

AVAILABLE TOOLS (grouped by family; tags: risk, mutates, dry-run-default):
${ctx.toolCatalog}

SKILLS (declarative commands, prefer them when relevant):
${ctx.skillCatalog || "(none loaded)"}

ENVIRONMENT: platform=${ctx.platform}, cwd=${ctx.cwd}`;
}

/** Compact catalog used by providers and by `tau ask --explain`. */
export function planningContext(intent: string, skillCatalog: string): PlanningContext {
  return {
    intent,
    toolCatalog: renderToolCatalog(),
    skillCatalog,
    platform: `${process.platform}`,
    cwd: process.cwd(),
  };
}

/** Convenience for tests/docs: list registered tool names. */
export function toolNames(): string[] {
  return allTools().map((tool) => tool.name);
}
