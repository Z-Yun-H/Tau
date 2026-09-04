/**
 * Prompt construction + AI-plan validation.
 * Builds the system prompt from the live tool registry, sends it through the
 * provider, and parses the reply with a zod-strict Plan schema (markdown
 * fences tolerated, malformed plans rejected).
 */

import { z } from "zod";
import { renderToolCatalog, catalogSummary } from "@tau/tools";
import type { ImageAttachment, PlanningContext, Plan, PriorTurn } from "@tau/core";

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

/**
 * Compact catalog used by providers and by `tau ask --explain`.
 *
 * `attachments` + `visionCapable` (image parsing module, issue #135): when
 * images ride the request, a text annotation per image is folded into the
 * user-side intent — the single choke point that gives EVERY provider
 * (including the text-only ones) honest context about what was attached.
 * Vision-capable providers additionally map the payloads into their wire
 * shape from `ctx.attachments`; text-only providers see the annotation
 * saying the image was dropped. Byte-identical output when no attachments
 * are supplied (pinned by tests).
 */
export function planningContext(
  intent: string,
  skillCatalog: string,
  priorTurns?: PriorTurn[],
  attachments?: ImageAttachment[],
  visionCapable = false,
): PlanningContext {
  const presented =
    priorTurns === undefined || priorTurns.length === 0
      ? intent
      : `${renderPriorTurns(priorTurns)}\n\nCurrent request: ${intent}`;
  const withImages =
    attachments === undefined || attachments.length === 0
      ? presented
      : `${presented}\n\n${renderAttachmentNotes(attachments, visionCapable)}`;
  return {
    intent: withImages,
    toolCatalog: renderToolCatalog(),
    skillCatalog,
    platform: `${process.platform}`,
    cwd: process.cwd(),
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
  };
}

/**
 * Fold prior conversation turns into the user-side message (issue #134).
 * Every provider sends `ctx.intent` as its user turn verbatim, so this one
 * choke point gives ALL providers conversation context with zero provider
 * changes. Byte-identical output when no turns are supplied (pinned by
 * tests), so absent history never changes a prompt.
 */
export function renderPriorTurns(priorTurns: PriorTurn[]): string {
  const turns = priorTurns.slice(-MAX_PRIOR_TURNS);
  const body = turns
    .map((turn) => {
      const text =
        turn.text.length > MAX_TURN_CHARS ? `${turn.text.slice(0, MAX_TURN_CHARS)}…` : turn.text;
      return `${turn.role}: ${text}`;
    })
    .join("\n");
  return `<conversation>\n${body}\n</conversation>`;
}

const MAX_PRIOR_TURNS = 12;
const MAX_TURN_CHARS = 4000;

/** Display-name cap for attachment annotations (file names can be long). */
const MAX_ATTACHMENT_NAME = 60;

/**
 * Text annotation for attached images (issue #135), folded into the
 * planning intent by {@link planningContext}. Vision-capable providers
 * attach the real payloads next to this note; text-only providers get the
 * honest "image was dropped" wording so a model never believes it saw
 * pixels it cannot see.
 */
export function renderAttachmentNotes(
  attachments: ImageAttachment[],
  visionCapable: boolean,
): string {
  const lines = attachments.map((attachment, index) => {
    const rawName = typeof attachment.name === "string" ? attachment.name.trim() : "";
    const name = rawName
      ? rawName.length > MAX_ATTACHMENT_NAME
        ? `${rawName.slice(0, MAX_ATTACHMENT_NAME)}…`
        : rawName
      : `image ${index + 1}`;
    const note = visionCapable
      ? "attached to this message"
      : "this provider cannot see images — the image was dropped";
    return `[image ${index + 1}: ${name}, ${attachment.mediaType} — ${note}]`;
  });
  return `<attachments>\n${lines.join("\n")}\n</attachments>`;
}
