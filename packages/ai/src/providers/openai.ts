/**
 * OpenAI-compatible provider (OpenAI, Moonshot, vLLM, ...).
 * JSON chat completions with response_format=json_object; the model catalog
 * comes live from GET {baseUrl}/models, resolved dynamically per request.
 *
 * The shared HTTP scaffolding (apiKey/baseUrl/timeout/listModels/isAvailable)
 * lives in `./base.ts` `BaseHttpProvider`. This subclass owns only the
 * OpenAI chat-completions wire shape (request body + response parsing).
 */

import { buildSystemPrompt, validatePlanResponse } from "../prompt.js";
import { chatJSON } from "./http.js";
import { BaseHttpProvider } from "./base.js";
import type { Plan, PlanningContext } from "@tau/core";

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

  async plan(ctx: PlanningContext): Promise<Plan> {
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
          { role: "system", content: buildSystemPrompt(ctx) },
          { role: "user", content: ctx.intent },
        ],
      },
      this.timeoutMs(),
    );
    const parsed = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }> };
    const content = parsed.choices?.[0]?.message?.content ?? "";
    return validatePlanResponse(content);
  }
}
