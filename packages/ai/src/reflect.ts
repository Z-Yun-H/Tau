/**
 * Multi-round reflection contract — the agent-loop half of the provider
 * surface (types live in @tau/core, wire shaping + validation here).
 *
 * After each executed round the agent loop hands the provider a
 * {@link ReflectContext} (intent + executed rounds with truncated outputs)
 * and expects a STRICT JSON {@link AgentDecision}: either the goal is done
 * (with a final answer) or one more plan should run. The decision's plan is
 * validated through the SAME strict step schema as first-round plans and is
 * ALWAYS re-graded by the deterministic safety reviewer — the AI never
 * grades itself (golden rule 2).
 */

import { z } from "zod";
import type { AgentDecision, Plan, ReflectContext } from "@tau/core";
import { planStepSchema } from "./prompt.js";

/** `done` branch: the provider declares the goal complete. */
const doneSchema = z
  .object({
    done: z.literal(true),
    /** Final user-facing answer summarizing what was accomplished. */
    answer: z.string().min(1),
  })
  .strict();

/** `continue` branch: one more round should run (plan re-reviewed downstream). */
const continueSchema = z
  .object({
    done: z.literal(false),
    explanation: z.string().min(1),
    steps: z.array(planStepSchema).min(1).max(10),
    note: z.string().optional(),
  })
  .strict();

/** Strict shape of the provider's reflection reply. */
export const reflectSchema = z.discriminatedUnion("done", [doneSchema, continueSchema]);

export type RawReflectDecision = z.infer<typeof reflectSchema>;

/** Output-truncation budget per step, applied by the LOOP before feedback. */
export const REFLECT_OUTPUT_SLICE = 4_000;

/** How many recent rounds the prompt keeps verbatim (older rounds compress). */
export const REFLECT_MAX_ROUNDS_IN_PROMPT = 3;

/** Truncate one step output for feedback (loop-side, provider-agnostic). */
export function truncateForFeedback(output: string): string {
  return output.length > REFLECT_OUTPUT_SLICE
    ? `${output.slice(0, REFLECT_OUTPUT_SLICE)}\n... (output truncated)`
    : output;
}

/** Parse+validate a provider reflection reply. Readable errors on failure. */
export function validateReflectResponse(raw: string): AgentDecision {
  let jsonText = raw.trim();

  // Same tolerances as plan validation: markdown fences, leading prose.
  const fence = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) jsonText = fence[1].trim();
  const start = jsonText.indexOf("{");
  const end = jsonText.lastIndexOf("}");
  if (start > 0 || (end !== -1 && end < jsonText.length - 1)) {
    if (start !== -1 && end > start) jsonText = jsonText.slice(start, end + 1);
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonText);
  } catch {
    throw new Error("Provider reflection was not valid JSON — refusing to continue the goal.");
  }
  const result = reflectSchema.safeParse(parsedJson);
  if (!result.success) {
    throw new Error(
      `Reflection failed schema validation: ${result.error.issues.map((i) => i.message).join("; ")}`,
    );
  }
  const rawDecision = result.data;
  if (rawDecision.done) {
    return { done: true, answer: rawDecision.answer };
  }
  const plan: Plan = {
    explanation: rawDecision.explanation,
    steps: rawDecision.steps.map((step) => ({
      kind: step.kind,
      tool: step.tool,
      command: step.command,
      args: step.args,
      reason: step.reason ?? "",
    })),
  };
  return rawDecision.note === undefined
    ? { done: false, plan }
    : { done: false, plan, note: rawDecision.note };
}

/** Render one executed round for the reflection prompt. */
function renderRound(feedback: ReflectContext["rounds"][number]): string {
  const lines: string[] = [];
  lines.push(`### Round ${feedback.round} — status: ${feedback.status}`);
  lines.push(`plan explanation: ${feedback.plan.explanation}`);
  feedback.plan.steps.forEach((step, i) => {
    const what =
      step.kind === "tool" ? `tool ${step.tool ?? "?"}` : `shell $ ${step.command ?? ""}`;
    lines.push(`  ${i + 1}. ${what}`);
  });
  feedback.outputs.forEach((output, i) => {
    lines.push(`  output of step ${i + 1}:`);
    lines.push(
      output
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n"),
    );
  });
  return lines.join("\n");
}

/**
 * Build the system prompt for the reflection call. Mirrors the planning
 * prompt's discipline: tools only from the catalog, strict JSON, the
 * continue-branch shape matches the plan schema so a proposed round is
 * indistinguishable (and reviewable) from a first-round plan.
 */
export function buildReflectPrompt(ctx: ReflectContext): string {
  // Keep the most recent rounds verbatim; older ones compress to a line.
  const recent = ctx.rounds.slice(-REFLECT_MAX_ROUNDS_IN_PROMPT);
  const olderCount = ctx.rounds.length - recent.length;

  return `You are Tau's goal reflector. A user gave an intent; one or more rounds of a plan have already executed. Decide what happens next.

RULES:
1. If the user's goal is ACHIEVABLE and the executed outputs already satisfy it, answer DONE: {"done": true, "answer": "<final user-facing summary>"}
2. If the goal needs more work, propose EXACTLY ONE more round: {"done": false, "explanation": string, "steps": [...], "note"?: string}
3. Steps follow the same rules as planning: registered tools from the catalog first, shell only when no tool fits, max 10 steps, each step needs a short "reason".
4. Never repeat a step whose output already answers the goal — read the outputs carefully.
5. If the goal FAILED and a focused repair is possible, propose the minimal repair round. If no plausible repair exists, answer DONE with an honest failure summary in "answer".
6. Answer with STRICT JSON only, no markdown — either the DONE shape or the continue shape above.

CATALOG SUMMARY: available tools are listed below; only these names are valid.

AVAILABLE TOOLS:
${ctx.toolCatalog}

SKILLS:
${ctx.skillCatalog || "(none loaded)"}

ENVIRONMENT: platform=${ctx.platform}, cwd=${ctx.cwd}

INTENT: ${ctx.intent}

EXECUTED ROUNDS${olderCount > 0 ? ` (${olderCount} earlier round(s) summarized: completed without changing the outcome)` : ""}:
${recent.map(renderRound).join("\n\n")}`;
}
