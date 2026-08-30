import { loadConfig } from "../../config/store.js";
import { buildSystemPrompt, validatePlanResponse } from "../prompt.js";
import { chatJSON } from "./mock.js";
import type { AIProvider, Plan, PlanningContext } from "../../types.js";

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

  async plan(ctx: PlanningContext): Promise<Plan> {
    const cfg = loadConfig();
    const model = String(cfg.providers["ollama"]?.["model"] ?? "llama3.1");
    const body = {
      model,
      stream: false,
      format: "json",
      messages: [
        { role: "system", content: buildSystemPrompt(ctx) },
        { role: "user", content: ctx.intent },
      ],
    };
    const raw = await chatJSON(`${this.host()}/api/chat`, {}, body);
    const content = (JSON.parse(raw) as { message?: { content?: string } }).message?.content ?? "";
    return validatePlanResponse(content);
  }
}
