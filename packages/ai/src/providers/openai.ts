/**
 * OpenAI-compatible provider (OpenAI, Moonshot, vLLM, ...).
 * JSON chat completions with response_format=json_object; the model catalog
 * comes live from GET {baseUrl}/models, resolved dynamically per request.
 *
 * The shared HTTP scaffolding (apiKey/baseUrl/timeout/listModels/isAvailable)
 * lives in `./base.ts` `BaseHttpProvider`. This subclass owns the
 * OpenAI chat-completions wire shape (request body + response parsing) and
 * serves BOTH capabilities that need it: `plan()` (first round) and the
 * inherited-from-here `reflect()` (agent loop continuation rounds).
 */

import { buildSystemPrompt, validatePlanResponse } from "../prompt.js";
import { buildReflectPrompt, validateReflectResponse } from "../reflect.js";
import { normalizeUsage } from "../usage.js";
import { chatJSON } from "./http.js";
import { BaseHttpProvider } from "./base.js";
import type { AgentDecision, Plan, PlanningContext, ReflectContext } from "@tau/core";

/** OpenAI-compatible providers (OpenAI, DeepSeek, Moonshot, vLLM, ...). */
export class OpenAIProvider extends BaseHttpProvider {
  readonly name = "openai";
  readonly label = "OpenAI-compatible";

  protected readonly config = {
    name: "openai",
    label: "OpenAI-compatible",
    envKey: "OPENAI_API_KEY",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultTimeoutMs: 60_000,
  };

  /**
   * One strict-JSON chat completion (system + user pair) — the shared wire
   * path for plan() and reflect(). Model resolution stays dynamic per
   * request via the catalog service; the request body is byte-identical
   * between both capabilities.
   */
  protected async chatCompletion(system: string, user: string): Promise<string> {
    // Dynamic import: models.ts pulls in the provider registry, and a static
    // edge here would create a registry -> provider -> models -> registry
    // cycle that breaks ESM module initialization.
    const { resolveModel } = await import("../models.js");
    // No bundled default: explicit user pick, the catalog's single model, or
    // an actionable error (see resolveModel).
    const { model } = await resolveModel(this.name);
    const raw = await chatJSON(
      `${this.baseUrl()}/chat/completions`,
      { authorization: `Bearer ${this.apiKey() ?? ""}` },
      {
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      },
      this.timeoutMs(),
      {
        // Observability (issue #98): capture the wire usage of THIS call —
        // read back via lastUsage right after the awaited plan/reflect call.
        onUsage: (usage) => {
          this.lastUsage = normalizeUsage(usage);
        },
      },
    );
    const parsed = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }> };
    return parsed.choices?.[0]?.message?.content ?? "";
  }

  async plan(ctx: PlanningContext): Promise<Plan> {
    return validatePlanResponse(await this.chatCompletion(buildSystemPrompt(ctx), ctx.intent));
  }

  /** Agent-loop continuation: same wire path, reflection prompt + schema. */
  async reflect(ctx: ReflectContext): Promise<AgentDecision> {
    return validateReflectResponse(
      await this.chatCompletion(buildReflectPrompt(ctx), lastRoundDigest(ctx)),
    );
  }
}

/**
 * The user-side message of a reflection call: a compact digest of the most
 * recent round (the system prompt already carries full round history), so
 * the turn mirrors the plan call's "one system prompt + one user message"
 * shape that json_object-mode models expect.
 */
function lastRoundDigest(ctx: ReflectContext): string {
  const last = ctx.rounds[ctx.rounds.length - 1];
  if (!last) return ctx.intent;
  const outputs = last.outputs.map((output, i) => `step ${i + 1}: ${output}`).join("\n");
  return `Round ${last.round} finished with status ${last.status}.\nIntent: ${ctx.intent}\nOutputs:\n${outputs}`;
}
