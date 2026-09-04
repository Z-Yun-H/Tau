/**
 * OpenAI-compatible provider (OpenAI, Moonshot, vLLM, ...).
 * JSON chat completions with response_format=json_object; the model catalog
 * comes live from GET {baseUrl}/models, resolved dynamically per request.
 *
 * The shared HTTP scaffolding (apiKey/baseUrl/timeout/listModels/isAvailable)
 * lives in `./base.ts` `BaseHttpProvider`. This subclass owns the
 * OpenAI chat-completions wire shape (request body + response parsing) and
 * serves THREE capabilities that need it: `plan()` (first round, buffered),
 * `planStream()` (streaming, reasoning-aware — v0.5.0) and the
 * inherited-from-here `reflect()` (agent loop continuation rounds).
 */

import { buildSystemPrompt, validatePlanResponse } from "../prompt.js";
import { buildReflectPrompt, validateReflectResponse } from "../reflect.js";
import { normalizeUsage } from "../usage.js";
import { consumeOpenAiCompatibleStream } from "../chat-stream.js";
import { chatJSON } from "./http.js";
import { BaseHttpProvider } from "./base.js";
import type {
  AgentDecision,
  ImageAttachment,
  Plan,
  PlanningContext,
  ProviderStreamHandler,
  ReflectContext,
} from "@tau/core";

/** OpenAI-compatible providers (OpenAI, DeepSeek, Moonshot, vLLM, ...). */
export class OpenAIProvider extends BaseHttpProvider {
  readonly name = "openai";
  readonly label = "OpenAI-compatible";
  /** Vision-capable (issue #135): attachments map to image_url content parts. */
  readonly supportsVision = true;

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
  protected async chatCompletion(
    system: string,
    user: string,
    attachments?: ImageAttachment[],
  ): Promise<string> {
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
          { role: "user", content: userContent(user, attachments) },
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
    return validatePlanResponse(
      await this.chatCompletion(buildSystemPrompt(ctx), ctx.intent, ctx.attachments),
    );
  }

  /**
   * Streaming chat completion (v0.5.0): same request shape as
   * chatCompletion with `stream: true` + `stream_options.include_usage`;
   * `reasoning_content` deltas (thinking models served over
   * OpenAI-compatible endpoints) relay as reasoning events and never mix
   * into the reply text. Shared wire path for planStream() and
   * reflectStream().
   */
  protected async streamChatCompletion(
    system: string,
    user: string,
    onEvent?: ProviderStreamHandler,
    attachments?: ImageAttachment[],
  ): Promise<string> {
    // Dynamic import: models.ts pulls in the provider registry, and a static
    // edge here would create a registry -> provider -> models -> registry
    // cycle that breaks ESM module initialization.
    const { resolveModel } = await import("../models.js");
    const { model } = await resolveModel(this.name);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs());
    timer.unref?.();
    try {
      const doFetch = globalThis.fetch;
      const response = await doFetch(`${this.baseUrl()}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey() ?? ""}`,
          accept: "text/event-stream",
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          response_format: { type: "json_object" },
          stream: true,
          stream_options: { include_usage: true },
          messages: [
            { role: "system", content: system },
            { role: "user", content: userContent(user, attachments) },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 300);
        throw new Error(`HTTP ${response.status} from provider: ${detail}`);
      }
      if (!response.body) {
        throw new Error("provider returned no response body");
      }
      return await consumeOpenAiCompatibleStream(response.body, onEvent);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(`provider request timed out after ${Math.round(this.timeoutMs() / 1000)}s`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Agent-loop continuation: same wire path, reflection prompt + schema. */
  async reflect(ctx: ReflectContext): Promise<AgentDecision> {
    return validateReflectResponse(
      await this.chatCompletion(buildReflectPrompt(ctx), lastRoundDigest(ctx)),
    );
  }

  /**
   * Streaming plan (v0.5.0): shared streaming wire path, same validation
   * gate — streaming never weakens the plan contract.
   */
  async planStream(ctx: PlanningContext, onEvent?: ProviderStreamHandler): Promise<Plan> {
    return validatePlanResponse(
      await this.streamChatCompletion(buildSystemPrompt(ctx), ctx.intent, onEvent, ctx.attachments),
    );
  }

  /** Streaming reflection — same wire path, deltas relayed, same schema. */
  async reflectStream(
    ctx: ReflectContext,
    onEvent?: ProviderStreamHandler,
  ): Promise<AgentDecision> {
    return validateReflectResponse(
      await this.streamChatCompletion(buildReflectPrompt(ctx), lastRoundDigest(ctx), onEvent),
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

/**
 * OpenAI chat-completions user content (issue #135): a plain string when no
 * images ride along (byte-identical to the historical wire), a multipart
 * content array (`text` + one `image_url` data URL per attachment) when
 * they do. The data URL embeds the sender-claimed media type; front doors
 * whitelist the type and probe the magic number before it gets here.
 */
function userContent(
  user: string,
  attachments?: ImageAttachment[],
): string | Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }> {
  if (!attachments || attachments.length === 0) return user;
  return [
    { type: "text", text: user },
    ...attachments.map((attachment) => ({
      type: "image_url" as const,
      image_url: { url: `data:${attachment.mediaType};base64,${attachment.dataBase64}` },
    })),
  ];
}
