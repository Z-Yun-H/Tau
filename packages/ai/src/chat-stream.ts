/**
 * Unified streaming chat wire layer (v0.5.0) — provider-agnostic event
 * folding for the four streaming wire shapes Tau speaks:
 *
 * - OpenAI-compatible chat-completions SSE (`stream: true` +
 *   `stream_options.include_usage`, `data: [DONE]` sentinel, optional
 *   `reasoning_content` deltas as emitted by thinking models served over
 *   OpenAI-compatible endpoints — DeepSeek-R1, GLM, ...).
 * - Anthropic Messages SSE (`message_start` / `content_block_start` /
 *   `content_block_delta` (`text_delta` | `thinking_delta`) /
 *   `content_block_stop` / `message_delta` / `message_stop`).
 * - Google Gemini `:streamGenerateContent?alt=sse` JSON frames
 *   (`candidates[].content.parts[]` with `thought` markers +
 *   `usageMetadata`).
 * - Ollama `/api/chat` NDJSON frames (`message.content` /
 *   `message.thinking` deltas + terminal counts frame).
 *
 * Every parser consumes a response body stream and folds it into the
 * provider-agnostic {@link ProviderStreamEvent} protocol from `@tau/core`
 * (`reasoning_delta` / `text_delta` / `usage`). Parsing failures never
 * crash mid-stream silently: a malformed frame throws (the provider layer
 * turns that into an actionable error), because partial plan text is
 * validated by `validatePlanResponse` afterwards — garbage can never reach
 * the safety reviewer.
 *
 * Streaming NEVER weakens the plan contract: the assembled text goes
 * through the same zod validation as the non-streaming path.
 */

import { normalizeUsage } from "./usage.js";
import type { ProviderStreamHandler } from "@tau/core";

/**
 * Yield every SSE `data:` payload in stream order, including the `[DONE]`
 * sentinel when the wire sends one. SSE comments (`:`), blank separators,
 * and non-data fields are ignored. Chunk boundaries anywhere are tolerated
 * (multi-byte safe via streaming TextDecoder).
 */
export async function* iterateSseDataPayloads(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
      buffer = buffer.slice(newlineIndex + 1);
      if (line.startsWith(":") || line.length === 0) continue; // comment / separator
      if (!line.startsWith("data:")) continue; // ignore event/other fields
      const payload = line.slice(5).trim();
      if (payload.length === 0) continue;
      yield payload;
    }
  }
}

/**
 * Yield every NDJSON frame (Ollama chat stream). Tolerates chunk boundaries
 * anywhere and skips blank lines; frames are NOT parsed here.
 */
export async function* iterateNdjsonFrames(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
      buffer = buffer.slice(newlineIndex + 1);
      if (line.trim().length > 0) yield line;
    }
  }
  const rest = buffer.trim();
  if (rest.length > 0) yield rest; // defensive: trailing unterminated frame
}

/** Parse one SSE/NDJSON frame as JSON with a readable failure message. */
function parseFrame<T>(payload: string, wire: string): T {
  try {
    return JSON.parse(payload) as T;
  } catch {
    throw new Error(`${wire} stream sent a non-JSON data frame — refusing to continue.`);
  }
}

/* ------------------------------------------------------------------ *
 * OpenAI-compatible chat-completions SSE
 * ------------------------------------------------------------------ */

interface OpenAiStreamChunk {
  choices?: Array<{
    delta?: { content?: string | null; reasoning_content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: Record<string, unknown>;
}

/**
 * Consume an OpenAI-compatible SSE chat-completions stream and fold it into
 * provider events. `reasoning_content` deltas (thinking models) map to
 * `reasoning_delta`, content deltas to `text_delta`, the trailing usage
 * chunk to `usage`. Returns the assembled content text (the plan document).
 */
export async function consumeOpenAiCompatibleStream(
  body: ReadableStream<Uint8Array>,
  onEvent?: ProviderStreamHandler,
): Promise<string> {
  let text = "";
  let sawUsage = false;
  for await (const payload of iterateSseDataPayloads(body)) {
    if (payload === "[DONE]") break;
    const parsed = parseFrame<OpenAiStreamChunk>(payload, "OpenAI-compatible");
    const delta = parsed.choices?.[0]?.delta;
    if (typeof delta?.reasoning_content === "string" && delta.reasoning_content.length > 0) {
      onEvent?.({ type: "reasoning_delta", text: delta.reasoning_content });
    }
    if (typeof delta?.content === "string" && delta.content.length > 0) {
      text += delta.content;
      onEvent?.({ type: "text_delta", text: delta.content });
    }
    if (parsed.usage) {
      const usage = normalizeUsage(parsed.usage);
      if (usage) {
        sawUsage = true;
        onEvent?.({ type: "usage", usage });
      }
    }
  }
  if (text.length === 0 && !sawUsage) {
    throw new Error("OpenAI-compatible stream closed before any content arrived.");
  }
  return text;
}

/* ------------------------------------------------------------------ *
 * Anthropic Messages SSE
 * ------------------------------------------------------------------ */

type AnthropicEvent =
  | {
      type: "message_start";
      message?: { usage?: { input_tokens?: unknown; output_tokens?: unknown } };
    }
  | { type: "content_block_start"; index: number; content_block?: { type?: string } }
  | {
      type: "content_block_delta";
      index: number;
      delta?: {
        type?: string;
        text?: string;
        thinking?: string;
        partial_json?: string;
      };
    }
  | { type: "content_block_stop"; index: number }
  | {
      type: "message_delta";
      delta?: { stop_reason?: string };
      usage?: { output_tokens?: unknown; input_tokens?: unknown };
    }
  | { type: "message_stop" }
  | { type: "ping" }
  | { type: "error"; error?: { message?: string } };

/** Anthropic usage fields are plain numbers (or absent) — read them raw. */
function asCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Consume an Anthropic Messages SSE stream. `thinking_delta` maps to
 * `reasoning_delta`, `text_delta` to `text_delta`; usage folds from
 * `message_start` (input) + `message_delta` (output). `input_json_delta`
 * frames (tool_use blocks) carry no user-visible text for Tau's plan
 * contract and are ignored (the plan text is the concatenated text blocks).
 * Returns the assembled text content.
 */
export async function consumeAnthropicStream(
  body: ReadableStream<Uint8Array>,
  onEvent?: ProviderStreamHandler,
): Promise<string> {
  let text = "";
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let reportedUsage = false;

  for await (const payload of iterateSseDataPayloads(body)) {
    const parsed = parseFrame<AnthropicEvent>(payload, "Anthropic");
    if (parsed.type === "message_start") {
      inputTokens = asCount(parsed.message?.usage?.input_tokens);
      const startOutput = asCount(parsed.message?.usage?.output_tokens);
      if (startOutput !== undefined) outputTokens = startOutput;
    } else if (parsed.type === "content_block_delta") {
      const delta = parsed.delta;
      if (delta?.type === "thinking_delta" && typeof delta.thinking === "string") {
        if (delta.thinking.length > 0) {
          onEvent?.({ type: "reasoning_delta", text: delta.thinking });
        }
      } else if (delta?.type === "text_delta" && typeof delta.text === "string") {
        if (delta.text.length > 0) {
          text += delta.text;
          onEvent?.({ type: "text_delta", text: delta.text });
        }
      }
      // `signature_delta` / `input_json_delta` — not plan text, ignored.
    } else if (parsed.type === "message_delta") {
      // Anthropic reports usage in ITS OWN field names (input_tokens /
      // output_tokens, output cumulative) — NOT the OpenAI shapes
      // normalizeUsage folds, so read them raw here.
      const out = asCount(parsed.usage?.output_tokens);
      if (out !== undefined) outputTokens = out;
      const inp = asCount(parsed.usage?.input_tokens);
      if (inp !== undefined) inputTokens = inp;
    } else if (parsed.type === "error") {
      throw new Error(
        `Anthropic stream error: ${parsed.error?.message ?? "unknown provider error"}`,
      );
    }
  }

  if (inputTokens !== undefined || outputTokens !== undefined) {
    const usage = normalizeUsage({
      prompt_tokens: inputTokens ?? 0,
      completion_tokens: outputTokens ?? 0,
    });
    if (usage) {
      reportedUsage = true;
      onEvent?.({ type: "usage", usage });
    }
  }
  if (text.length === 0 && !reportedUsage) {
    throw new Error("Anthropic stream closed before any content arrived.");
  }
  return text;
}

/* ------------------------------------------------------------------ *
 * Google Gemini streamGenerateContent (alt=sse)
 * ------------------------------------------------------------------ */

interface GeminiStreamFrame {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    finishReason?: string;
  }>;
  usageMetadata?: Record<string, unknown>;
}

/**
 * Consume a Gemini `:streamGenerateContent?alt=sse` frame stream. Parts
 * with `thought: true` map to `reasoning_delta`, plain text parts to
 * `text_delta`; the trailing `usageMetadata` maps to `usage`. Returns the
 * assembled plan text (non-thought parts concatenated).
 */
export async function consumeGeminiStream(
  body: ReadableStream<Uint8Array>,
  onEvent?: ProviderStreamHandler,
): Promise<string> {
  let text = "";
  let sawFrame = false;
  for await (const payload of iterateSseDataPayloads(body)) {
    const parsed = parseFrame<GeminiStreamFrame>(payload, "Gemini");
    sawFrame = true;
    for (const part of parsed.candidates?.[0]?.content?.parts ?? []) {
      if (typeof part.text !== "string" || part.text.length === 0) continue;
      if (part.thought === true) {
        onEvent?.({ type: "reasoning_delta", text: part.text });
      } else {
        text += part.text;
        onEvent?.({ type: "text_delta", text: part.text });
      }
    }
    if (parsed.usageMetadata) {
      const usage = normalizeUsage(parsed.usageMetadata);
      if (usage) onEvent?.({ type: "usage", usage });
    }
  }
  if (!sawFrame || text.length === 0) {
    throw new Error("Gemini stream closed before any content arrived.");
  }
  return text;
}

/* ------------------------------------------------------------------ *
 * Ollama /api/chat NDJSON
 * ------------------------------------------------------------------ */

interface OllamaChatFrame {
  message?: { content?: string | null; thinking?: string | null };
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * Consume an Ollama chat NDJSON stream. `message.thinking` deltas (models
 * with thinking enabled) map to `reasoning_delta`, `message.content` to
 * `text_delta`; the terminal `done: true` frame's counts map to `usage`.
 * Returns the assembled content text.
 */
export async function consumeOllamaStream(
  body: ReadableStream<Uint8Array>,
  onEvent?: ProviderStreamHandler,
): Promise<string> {
  let text = "";
  let sawFrame = false;
  let sawUsage = false;
  for await (const line of iterateNdjsonFrames(body)) {
    const parsed = parseFrame<OllamaChatFrame>(line, "Ollama");
    sawFrame = true;
    const thinking = parsed.message?.thinking;
    if (typeof thinking === "string" && thinking.length > 0) {
      onEvent?.({ type: "reasoning_delta", text: thinking });
    }
    const content = parsed.message?.content;
    if (typeof content === "string" && content.length > 0) {
      text += content;
      onEvent?.({ type: "text_delta", text: content });
    }
    if (parsed.done === true) {
      const usage = normalizeUsage({
        prompt_eval_count: parsed.prompt_eval_count,
        eval_count: parsed.eval_count,
      });
      if (usage) {
        sawUsage = true;
        onEvent?.({ type: "usage", usage });
      }
    }
  }
  if (!sawFrame || (text.length === 0 && !sawUsage)) {
    throw new Error("Ollama stream closed before any content arrived.");
  }
  return text;
}
