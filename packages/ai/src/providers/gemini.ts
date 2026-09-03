/**
 * Google Gemini provider — Generative Language API over plain fetch.
 *
 * Wire reference: Google Gemini API docs (POST
 * /v1beta/models/{model}:generateContent and :streamGenerateContent?alt=sse,
 * GET /v1beta/models discovery, `x-goog-api-key` header auth,
 * `generationConfig.responseMimeType: "application/json"` as Gemini's JSON
 * mode, `parts[].thought` markers for 2.5-series thinking). Zero
 * dependencies: request shaping here, SSE folding in `../chat-stream.ts`,
 * shared scaffolding from `BaseHttpProvider`.
 *
 * Both `GOOGLE_API_KEY` and `GEMINI_API_KEY` are accepted as env fallbacks
 * (Google documents both names); config `providers.gemini.apiKey` wins over
 * both. Thinking budget is configurable via
 * `providers.gemini.thinkingBudget` (omitted by default — the model's own
 * dynamic thinking applies).
 */

import { loadConfig } from "@tau/core";
import { buildSystemPrompt, validatePlanResponse } from "../prompt.js";
import { buildReflectPrompt, validateReflectResponse } from "../reflect.js";
import { consumeGeminiStream } from "../chat-stream.js";
import { BaseHttpProvider } from "./base.js";
import type { ProviderStreamHandler } from "@tau/core";
import type { AgentDecision, ModelInfo, Plan, PlanningContext, ReflectContext } from "@tau/core";

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_TIMEOUT_MS = 120_000;
/** Default thinking budget when `providers.gemini.thinkingBudget` is set. */
const MIN_THINKING_BUDGET = 128;

export class GeminiProvider extends BaseHttpProvider {
  readonly name = "gemini";
  readonly label = "Google (Gemini)";

  protected readonly config = {
    name: "gemini",
    label: "Google (Gemini)",
    envKey: "GOOGLE_API_KEY",
    defaultBaseUrl: DEFAULT_BASE_URL,
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
  };

  /** Google accepts both key names; config-first, then env in order. */
  override apiKey(): string | undefined {
    const fromConfig = loadConfig().providers[this.name]?.["apiKey"];
    if (typeof fromConfig === "string" && fromConfig.trim().length > 0) return fromConfig;
    return process.env["GOOGLE_API_KEY"] ?? process.env["GEMINI_API_KEY"];
  }

  override unavailableReason(): string {
    return (
      `Missing ${this.label} API key — run \`tau provider set-key ${this.name} <key>\` ` +
      "or set the GOOGLE_API_KEY (or GEMINI_API_KEY) environment variable."
    );
  }

  /**
   * Thinking budget fragment when configured (default omitted — Gemini 2.5
   * models apply their own dynamic thinking; `thought` parts still stream
   * back and relay as reasoning events).
   */
  private thinkingBudgetFragment(): {
    thinkingConfig?: { thinkingBudget: number };
  } {
    const entry = loadConfig().providers[this.name];
    const raw = Number(entry?.["thinkingBudget"]);
    if (!Number.isFinite(raw) || raw < MIN_THINKING_BUDGET) return {};
    return { thinkingConfig: { thinkingBudget: Math.trunc(raw) } };
  }

  /** Live model discovery: GET {baseUrl}/models (Generative Language shape). */
  override async listModels(): Promise<ModelInfo[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    timer.unref?.();
    try {
      const doFetch = globalThis.fetch;
      const res = await doFetch(`${this.baseUrl()}/models?pageSize=100`, {
        headers: { "x-goog-api-key": this.apiKey() ?? "" },
        signal: controller.signal,
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 200);
        throw new Error(`${this.label} model listing failed (HTTP ${res.status}): ${detail}`);
      }
      const parsed = (await res.json()) as {
        models?: Array<{
          name?: string;
          displayName?: string;
          supportedGenerationMethods?: string[];
        }>;
      };
      return (
        (parsed.models ?? [])
          // Only planner-capable models: skip embeddings/aerank entries when
          // the discovery response declares its supported methods.
          .filter(
            (entry) =>
              entry.supportedGenerationMethods === undefined ||
              entry.supportedGenerationMethods.includes("generateContent"),
          )
          .map((entry) => ({
            id: typeof entry.name === "string" ? entry.name.replace(/^models\//, "") : "",
            displayName: entry.displayName,
          }))
          .filter((entry) => entry.id.length > 0)
          .map((entry) => ({
            id: entry.id,
            ...(entry.displayName ? { ownedBy: entry.displayName } : {}),
          }))
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** Request body shared by generateContent and streamGenerateContent. */
  private generateBody(system: string, user: string): Record<string, unknown> {
    return {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0,
        ...this.thinkingBudgetFragment(),
      },
    };
  }

  /**
   * One Generative Language turn. Streaming always (`:streamGenerateContent
   * ?alt=sse`): without an observer the deltas are dropped, which is exactly
   * the buffered plan() behavior — one wire path, two capabilities.
   */
  private async generateTurn(
    system: string,
    user: string,
    onEvent?: ProviderStreamHandler,
  ): Promise<string> {
    // Dynamic import avoids the registry -> provider -> models -> registry
    // ESM cycle (same convention as the other providers).
    const { resolveModel } = await import("../models.js");
    const { model } = await resolveModel(this.name);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs());
    timer.unref?.();
    try {
      const doFetch = globalThis.fetch;
      const response = await doFetch(
        `${this.baseUrl()}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey() ?? "" },
          body: JSON.stringify(this.generateBody(system, user)),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 300);
        throw new Error(`HTTP ${response.status} from provider: ${detail}`);
      }
      if (!response.body) throw new Error("provider returned no response body");
      return await consumeGeminiStream(response.body, onEvent);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`provider request timed out after ${Math.round(this.timeoutMs() / 1000)}s`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async plan(ctx: PlanningContext): Promise<Plan> {
    return validatePlanResponse(await this.generateTurn(buildSystemPrompt(ctx), ctx.intent));
  }

  /** Streaming plan — same wire, deltas relayed, same validation gate. */
  async planStream(ctx: PlanningContext, onEvent?: ProviderStreamHandler): Promise<Plan> {
    return validatePlanResponse(
      await this.generateTurn(buildSystemPrompt(ctx), ctx.intent, onEvent),
    );
  }

  /** Agent-loop continuation: same wire path, reflection prompt + schema. */
  async reflect(ctx: ReflectContext): Promise<AgentDecision> {
    return validateReflectResponse(
      await this.generateTurn(buildReflectPrompt(ctx), lastRoundDigest(ctx)),
    );
  }
}

/**
 * Compact digest of the most recent round for the reflection user turn —
 * mirrors the openai provider's shape (system prompt carries the history).
 */
function lastRoundDigest(ctx: ReflectContext): string {
  const last = ctx.rounds[ctx.rounds.length - 1];
  if (!last) return ctx.intent;
  const outputs = last.outputs.map((output, i) => `step ${i + 1}: ${output}`).join("\n");
  return `Round ${last.round} finished with status ${last.status}.\nIntent: ${ctx.intent}\nOutputs:\n${outputs}`;
}
