/**
 * Anthropic provider (Claude) — Messages API over plain fetch.
 *
 * Wire reference: Anthropic Messages API docs (POST /v1/messages,
 * GET /v1/models, streaming SSE with content_block_delta events,
 * extended thinking via the `thinking` parameter). Zero dependencies:
 * the request shaping lives here, the shared SSE folding in
 * `../chat-stream.ts`. The base scaffolding (apiKey resolution,
 * baseUrl/timeout defaults, isAvailable, unavailableReason) inherits
 * from `BaseHttpProvider`.
 *
 * Thinking models (Claude extended thinking): `providers.anthropic.thinking`
 * enables `thinking: {type: "enabled", budget_tokens}` on the wire —
 * thinking deltas then stream back as reasoning events and never mix into
 * the plan text. Per the API contract, temperature is omitted when
 * thinking is enabled (the API rejects temperature != 1 in that mode).
 */

import { loadConfig } from "@tau/core";
import { buildSystemPrompt, validatePlanResponse } from "../prompt.js";
import { buildReflectPrompt, validateReflectResponse } from "../reflect.js";
import { consumeAnthropicStream } from "../chat-stream.js";
import { BaseHttpProvider } from "./base.js";
import type { ImageAttachment, ProviderStreamHandler } from "@tau/core";
import type { AgentDecision, ModelInfo, Plan, PlanningContext, ReflectContext } from "@tau/core";

/** Anthropic Messages API defaults (AGENTS/ai-integration.md pattern). */
const DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_TIMEOUT_MS = 120_000;
/** Messages API requires an explicit generation budget; plans are small. */
const PLAN_MAX_TOKENS = 8192;
/** Pinned API version — bump deliberately, in a PR that re-runs the suite. */
const ANTHROPIC_VERSION = "2023-06-01";
/** Default thinking budget when `providers.anthropic.thinking` is true. */
const DEFAULT_THINKING_BUDGET = 4096;

export class AnthropicProvider extends BaseHttpProvider {
  readonly name = "anthropic";
  readonly label = "Anthropic (Claude)";
  /** Vision-capable (issue #135): attachments map to image source blocks. */
  readonly supportsVision = true;

  protected readonly config = {
    name: "anthropic",
    label: "Anthropic (Claude)",
    envKey: "ANTHROPIC_API_KEY",
    defaultBaseUrl: DEFAULT_BASE_URL,
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
  };

  /** Messages API auth + versioning headers (Bearer is NOT the auth scheme). */
  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      "x-api-key": this.apiKey() ?? "",
      "anthropic-version": ANTHROPIC_VERSION,
    };
  }

  /** Extended-thinking request fragment when configured (default off). */
  private thinkingFragment(): { thinking?: { type: "enabled"; budget_tokens: number } } {
    const entry = loadConfig().providers[this.name];
    if (entry?.["thinking"] !== true) return {};
    const raw = Number(entry["thinkingBudget"]);
    const budget = Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : DEFAULT_THINKING_BUDGET;
    return { thinking: { type: "enabled", budget_tokens: budget } };
  }

  /** Live model discovery: GET {baseUrl}/models (Anthropic Models API shape). */
  override async listModels(): Promise<ModelInfo[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    timer.unref?.();
    try {
      const doFetch = globalThis.fetch;
      const res = await doFetch(`${this.baseUrl()}/models?limit=100`, {
        headers: this.headers(),
        signal: controller.signal,
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 200);
        throw new Error(`${this.label} model listing failed (HTTP ${res.status}): ${detail}`);
      }
      const parsed = (await res.json()) as {
        data?: Array<{ id?: string; display_name?: string }>;
      };
      return (parsed.data ?? [])
        .filter(
          (entry): entry is { id: string; display_name?: string } => typeof entry.id === "string",
        )
        .map((entry) => ({
          id: entry.id,
          ...(entry.display_name ? { ownedBy: entry.display_name } : {}),
        }));
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * One Messages API turn → the concatenated text blocks (the plan
   * document). Streaming always (the wire path Tau speaks for Anthropic):
   * without an observer the deltas are simply dropped, which is exactly
   * the buffered plan() behavior.
   */
  private async messagesTurn(
    system: string,
    user: string,
    onEvent?: ProviderStreamHandler,
    attachments?: ImageAttachment[],
  ): Promise<string> {
    // Dynamic import avoids the registry -> provider -> models -> registry
    // ESM cycle (same convention as the other providers).
    const { resolveModel } = await import("../models.js");
    const { model } = await resolveModel(this.name);
    const thinking = this.thinkingFragment();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs());
    timer.unref?.();
    try {
      const doFetch = globalThis.fetch;
      const response = await doFetch(`${this.baseUrl()}/messages`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          model,
          max_tokens: PLAN_MAX_TOKENS,
          // temperature is omitted entirely when thinking is enabled —
          // the API rejects temperature != 1 in thinking mode.
          ...(thinking.thinking ? {} : { temperature: 0 }),
          ...thinking,
          system,
          messages: [{ role: "user", content: userContent(user, attachments) }],
          stream: true,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 300);
        throw new Error(`HTTP ${response.status} from provider: ${detail}`);
      }
      if (!response.body) throw new Error("provider returned no response body");
      return await consumeAnthropicStream(response.body, onEvent);
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
    return validatePlanResponse(
      await this.messagesTurn(buildSystemPrompt(ctx), ctx.intent, undefined, ctx.attachments),
    );
  }

  /** Streaming plan — same wire, deltas relayed, same validation gate. */
  async planStream(ctx: PlanningContext, onEvent?: ProviderStreamHandler): Promise<Plan> {
    return validatePlanResponse(
      await this.messagesTurn(buildSystemPrompt(ctx), ctx.intent, onEvent, ctx.attachments),
    );
  }

  /** Agent-loop continuation: same wire path, reflection prompt + schema. */
  async reflect(ctx: ReflectContext): Promise<AgentDecision> {
    return validateReflectResponse(
      await this.messagesTurn(buildReflectPrompt(ctx), lastRoundDigest(ctx)),
    );
  }

  /** Streaming reflection — same wire, deltas relayed, same schema. */
  async reflectStream(
    ctx: ReflectContext,
    onEvent?: ProviderStreamHandler,
  ): Promise<AgentDecision> {
    return validateReflectResponse(
      await this.messagesTurn(buildReflectPrompt(ctx), lastRoundDigest(ctx), onEvent),
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

/**
 * Messages API user content (issue #135): a plain string when no images
 * ride along (byte-identical to the historical wire), text + one base64
 * image source block per attachment when they do. The source's media_type
 * is the sender-claimed value; front doors whitelist it and probe the
 * magic number before it gets here.
 */
function userContent(
  user: string,
  attachments?: ImageAttachment[],
): string | Array<Record<string, unknown>> {
  if (!attachments || attachments.length === 0) return user;
  return [
    { type: "text", text: user },
    ...attachments.map((attachment) => ({
      type: "image",
      source: {
        type: "base64",
        media_type: attachment.mediaType,
        data: attachment.dataBase64,
      },
    })),
  ];
}
