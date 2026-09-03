/**
 * Ollama provider (local models).
 * Availability probes the local server; the model catalog is whatever is
 * installed (/api/tags) — never a bundled default list.
 */

import { loadConfig } from "@tau/core";
import { buildSystemPrompt, validatePlanResponse } from "../prompt.js";
import { consumeOllamaStream } from "../chat-stream.js";
import { chatJSON } from "./http.js";
import type {
  AIProvider,
  ModelInfo,
  Plan,
  PlanningContext,
  ProviderStreamHandler,
} from "@tau/core";

/** Ollama (local models). Available when the local server responds. */
export class OllamaProvider implements AIProvider {
  readonly name = "ollama";
  readonly label = "Ollama (local)";

  async isAvailable(): Promise<boolean> {
    try {
      const host = this.host();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(`${host}/api/tags`, { signal: controller.signal });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }

  unavailableReason(): string {
    return `Ollama server not reachable at ${this.host()} — start it with \`ollama serve\`.`;
  }

  private host(): string {
    const cfg = loadConfig();
    return String(cfg.providers["ollama"]?.["host"] ?? "http://localhost:11434");
  }

  /** Live model discovery: GET {host}/api/tags (installed local models). */
  async listModels(): Promise<ModelInfo[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const doFetch = globalThis.fetch;
      const res = await doFetch(`${this.host()}/api/tags`, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`Ollama model listing failed (HTTP ${res.status})`);
      }
      const parsed = (await res.json()) as {
        models?: Array<{ name?: string; model?: string }>;
      };
      return (parsed.models ?? [])
        .map((entry) => entry.name ?? entry.model)
        .filter((name): name is string => typeof name === "string" && name.length > 0)
        .map((name) => ({ id: name }));
    } finally {
      clearTimeout(timer);
    }
  }

  async plan(ctx: PlanningContext): Promise<Plan> {
    // Dynamic import avoids the registry -> provider -> models -> registry
    // ESM initialization cycle (see the note in providers/openai.ts).
    const { resolveModel } = await import("../models.js");
    // No bundled default: explicit user pick, the only installed model, or an
    // actionable error (see resolveModel).
    const { model } = await resolveModel(this.name);
    const body = {
      model,
      stream: false,
      format: "json",
      ...this.thinkFragment(),
      messages: [
        { role: "system", content: buildSystemPrompt(ctx) },
        { role: "user", content: ctx.intent },
      ],
    };
    const raw = await chatJSON(`${this.host()}/api/chat`, {}, body);
    const content = (JSON.parse(raw) as { message?: { content?: string } }).message?.content ?? "";
    return validatePlanResponse(content);
  }

  /**
   * Streaming plan (v0.5.0): /api/chat with `stream: true` answers NDJSON
   * frames — content deltas (and `thinking` deltas when the model thinks)
   * relay through the shared consumer; the terminal frame's token counts
   * relay as usage. `providers.ollama.think: true` requests thinking
   * explicitly (supported models only; the plain JSON format is kept).
   */
  async planStream(ctx: PlanningContext, onEvent?: ProviderStreamHandler): Promise<Plan> {
    const { resolveModel } = await import("../models.js");
    const { model } = await resolveModel(this.name);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120_000);
    timer.unref?.();
    try {
      const doFetch = globalThis.fetch;
      const response = await doFetch(`${this.host()}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          stream: true,
          format: "json",
          ...this.thinkFragment(),
          messages: [
            { role: "system", content: buildSystemPrompt(ctx) },
            { role: "user", content: ctx.intent },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 300);
        throw new Error(`HTTP ${response.status} from provider: ${detail}`);
      }
      if (!response.body) throw new Error("provider returned no response body");
      const text = await consumeOllamaStream(response.body, onEvent);
      return validatePlanResponse(text);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error("provider request timed out after 120s");
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /** `providers.ollama.think: true` → request thinking (additive opt-in). */
  private thinkFragment(): { think?: boolean } {
    const cfg = loadConfig();
    if (cfg.providers["ollama"]?.["think"] !== true) return {};
    return { think: true };
  }
}
