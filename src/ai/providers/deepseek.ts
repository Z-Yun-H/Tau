import { loadConfig } from "../../config/store.js";
import { buildSystemPrompt, validatePlanResponse } from "../prompt.js";
import type { AIProvider, Plan, PlanningContext } from "../../types.js";

/**
 * DeepSeek provider — self-contained streaming client for the official
 * DeepSeek chat-completions wire format (OpenAI-compatible SSE).
 *
 * Why hand-rolled instead of an SDK: DeepSeek's own harness adapter
 * (`@deepseek-ai/dsh-llm-deepseek`) is wired into the DeepSeek Harness
 * runtime (7 rc-stage peers incl. an unpublished package) and cannot be
 * installed standalone today. This provider implements the exact same wire
 * contract that adapter implements — `stream: true` +
 * `stream_options.include_usage`, `reasoning_content` deltas in thinking
 * mode, `data: [DONE]` framing — with zero dependencies, so it works
 * everywhere Node 20+ runs. If a message-only fallback is ever needed,
 * the endpoint also accepts plain (non-streaming) requests; we always
 * stream so usage is captured and slow plans render progress.
 *
 * Wire-format references: DeepSeek API docs (create-chat-completion,
 * thinking_mode, first-token-latency) — the same source of truth the
 * harness adapter documents.
 */

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-chat";
const DEFAULT_TIMEOUT_MS = 120_000;
/** Planning output is a small JSON document; cap the generation budget. */
const PLAN_MAX_TOKENS = 8192;

export interface DeepSeekStreamResult {
  text: string;
  reasoning: string;
  usage: Record<string, unknown> | null;
}

/**
 * Consume an OpenAI-compatible SSE chat-completions stream and accumulate
 * the assistant text. Tolerates: chunk boundaries anywhere (multi-byte
 * safe via streaming TextDecoder), `reasoning_content` deltas (thinking
 * models — collected separately, never mixed into the plan text),
 * usage-only trailing chunks, SSE comments, and blank lines.
 */
export async function collectStreamText(
  body: ReadableStream<Uint8Array>,
): Promise<DeepSeekStreamResult> {
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let reasoning = "";
  let usage: Record<string, unknown> | null = null;
  let done = false;

  const handleData = (payload: string): void => {
    if (payload === "[DONE]") {
      done = true;
      return;
    }
    let parsed: {
      choices?: Array<{ delta?: { content?: string | null; reasoning_content?: string | null } }>;
      usage?: Record<string, unknown>;
    };
    try {
      parsed = JSON.parse(payload);
    } catch {
      throw new Error("DeepSeek stream sent a non-JSON data frame — refusing to continue.");
    }
    const delta = parsed.choices?.[0]?.delta;
    if (typeof delta?.content === "string") text += delta.content;
    if (typeof delta?.reasoning_content === "string") reasoning += delta.reasoning_content;
    // include_usage: usage arrives on the finish chunk or a trailing
    // usage-only chunk (empty choices array).
    if (parsed.usage) usage = parsed.usage;
  };

  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
      buffer = buffer.slice(newlineIndex + 1);
      if (line.startsWith(":") || line.length === 0) continue; // comment / separator
      if (!line.startsWith("data:")) continue; // ignore event/other fields
      const payload = line.slice(5).trim();
      if (payload.length > 0) handleData(payload);
      if (done) return { text, reasoning, usage };
    }
  }
  // Stream ended without [DONE] — accept what we have if any text arrived,
  // otherwise the response was empty/invalid.
  if (!done && text.length === 0 && reasoning.length === 0) {
    throw new Error("DeepSeek stream closed before any content arrived.");
  }
  return { text, reasoning, usage };
}

/** Map a non-2xx DeepSeek response to a readable, actionable error. */
export function apiErrorMessage(status: number, bodyText: string): string {
  let detail = bodyText.slice(0, 300);
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: { message?: string; type?: string };
      message?: string;
    };
    detail = parsed.error?.message ?? parsed.message ?? detail;
  } catch {
    /* keep raw body text */
  }
  const hint =
    status === 401 || status === 403
      ? " (check DEEPSEEK_API_KEY)"
      : status === 429
        ? " (rate limited or out of balance)"
        : status >= 500
          ? " (DeepSeek server error, retry later)"
          : "";
  return `DeepSeek API error ${status}${hint}: ${detail}`;
}

/** DeepSeek planning provider over the official streaming wire format. */
export class DeepSeekProvider implements AIProvider {
  readonly name = "deepseek";
  readonly label = "DeepSeek";

  apiKey(): string | undefined {
    return process.env.DEEPSEEK_API_KEY;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey());
  }

  unavailableReason(): string {
    return "Missing DEEPSEEK_API_KEY environment variable.";
  }

  private baseUrl(): string {
    return String(loadConfig().providers["deepseek"]?.["baseUrl"] ?? DEFAULT_BASE_URL).replace(
      /\/$/,
      "",
    );
  }

  private timeoutMs(): number {
    const raw = loadConfig().providers["deepseek"]?.["timeoutMs"];
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
  }

  async plan(ctx: PlanningContext): Promise<Plan> {
    const cfg = loadConfig();
    const model = String(cfg.providers["deepseek"]?.["model"] ?? DEFAULT_MODEL);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs());
    timer.unref?.();

    let response: Response;
    try {
      // Node 20+ has global fetch; read it lazily so tests can stub it.
      const doFetch = globalThis.fetch;
      response = await doFetch(`${this.baseUrl()}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey() ?? ""}`,
          accept: "text/event-stream",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: buildSystemPrompt(ctx) },
            { role: "user", content: ctx.intent },
          ],
          stream: true,
          stream_options: { include_usage: true },
          max_tokens: PLAN_MAX_TOKENS,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          `DeepSeek request timed out after ${Math.round(this.timeoutMs() / 1000)}s — raise providers.deepseek.timeoutMs if your model is slow.`,
        );
      }
      throw new Error(
        `DeepSeek request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok || !response.body) {
      const bodyText = await response.text().catch(() => "");
      throw new Error(apiErrorMessage(response.status, bodyText));
    }

    const { text } = await collectStreamText(response.body);
    return validatePlanResponse(text);
  }
}
