import { loadConfig } from "../../config/store.js";
import { buildSystemPrompt, validatePlanResponse } from "../prompt.js";
import { chatJSON } from "./mock.js";
import type { AIProvider, Plan, PlanningContext } from "../../types.js";

/** OpenAI-compatible providers (OpenAI, DeepSeek, Moonshot, vLLM, ...). */
export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  readonly label = "OpenAI-compatible";

  apiKey(): string | undefined {
    return process.env.OPENAI_API_KEY;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey());
  }

  unavailableReason(): string {
    return "Missing OPENAI_API_KEY environment variable.";
  }

  private baseUrl(): string {
    return String(
      loadConfig().providers["openai"]?.["baseUrl"] ?? "https://api.openai.com/v1",
    ).replace(/\/$/, "");
  }

  async plan(ctx: PlanningContext): Promise<Plan> {
    const cfg = loadConfig();
    const model = String(cfg.providers["openai"]?.["model"] ?? "gpt-4o-mini");
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
    );
    const parsed = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }> };
    const content = parsed.choices?.[0]?.message?.content ?? "";
    return validatePlanResponse(content);
  }
}
