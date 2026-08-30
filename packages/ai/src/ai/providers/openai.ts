/**
 * OpenAI-compatible provider (OpenAI, Moonshot, vLLM, ...).
 * JSON chat completions with response_format=json_object; the model catalog
 * comes live from GET {baseUrl}/models, resolved dynamically per request.
 */

import { loadConfig } from "@tau/core";
import { buildSystemPrompt, validatePlanResponse } from "../prompt.js";
import { chatJSON } from "./mock.js";
import type { AIProvider, ModelInfo, Plan, PlanningContext } from "@tau/core";

/** OpenAI-compatible providers (OpenAI, DeepSeek, Moonshot, vLLM, ...). */
export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  readonly label = "OpenAI-compatible";

  /** Config key (`tau provider set-key openai`) wins; env var is the fallback. */
  apiKey(): string | undefined {
    const fromConfig = loadConfig().providers["openai"]?.["apiKey"];
    if (typeof fromConfig === "string" && fromConfig.trim().length > 0) return fromConfig;
    return process.env.OPENAI_API_KEY;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey());
  }

  unavailableReason(): string {
    return "Missing OpenAI API key — run `tau provider set-key openai <key>` or set OPENAI_API_KEY.";
  }

  private baseUrl(): string {
    return String(
      loadConfig().providers["openai"]?.["baseUrl"] ?? "https://api.openai.com/v1",
    ).replace(/\/$/, "");
  }

  /** Live model discovery: GET {baseUrl}/models (OpenAI-compatible shape). */
  async listModels(): Promise<ModelInfo[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const doFetch = globalThis.fetch;
      const res = await doFetch(`${this.baseUrl()}/models`, {
        headers: { authorization: `Bearer ${this.apiKey() ?? ""}` },
        signal: controller.signal,
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 200);
        throw new Error(`OpenAI model listing failed (HTTP ${res.status}): ${detail}`);
      }
      const parsed = (await res.json()) as {
        data?: Array<{ id?: string; owned_by?: string }>;
      };
      return (parsed.data ?? [])
        .filter((entry): entry is { id: string; owned_by?: string } => typeof entry.id === "string")
        .map((entry) => ({ id: entry.id, ...(entry.owned_by ? { ownedBy: entry.owned_by } : {}) }));
    } finally {
      clearTimeout(timer);
    }
  }

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
    );
    const parsed = JSON.parse(raw) as { choices?: Array<{ message?: { content?: string } }> };
    const content = parsed.choices?.[0]?.message?.content ?? "";
    return validatePlanResponse(content);
  }
}
