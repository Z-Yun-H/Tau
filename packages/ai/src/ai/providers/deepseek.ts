/**
 * DeepSeek provider — streaming planner speaking the official wire contract.
 * Dual path: the optional @deepseek-ai/dsh-llm harness (official LlmAdapter +
 * BlockAssembler) with a byte-identical zero-dependency fallback (SSE over
 * fetch). Model resolves dynamically via resolveModel — no bundled default.
 */

import { createRequire } from "node:module";
import { loadConfig } from "@tau/core";
import { buildSystemPrompt, validatePlanResponse } from "../prompt.js";
import type { AIProvider, ModelInfo, Plan, PlanningContext } from "@tau/core";
// Type-only imports from the optional @deepseek-ai/dsh-llm package: the
// compiler erases them, so they are safe even when the package is absent at
// runtime. Runtime access goes exclusively through the dynamic loader below.
import type {
  AppIdentity,
  BlockAssembler as BlockAssemblerType,
  CallId,
  ContentBlock,
  FinishReason,
  GenerateOptions,
  LlmAdapter as LlmAdapterType,
  LlmFailure,
  Message,
  StreamChunk,
  TokenUsage,
} from "@deepseek-ai/dsh-llm";

/**
 * DeepSeek provider — streaming client for the official DeepSeek
 * chat-completions wire format (OpenAI-compatible SSE), speaking the
 * `@deepseek-ai/dsh-llm` harness vocabulary.
 *
 * Architecture (two paths, identical wire contract):
 *
 * 1. Harness path (preferred). `@deepseek-ai/dsh-llm` is the DeepSeek
 *    Harness' provider-neutral LLM seam: the `LlmAdapter` abstract class,
 *    the canonical `StreamChunk` protocol (block-start / text-delta /
 *    reasoning-delta / tool-call-delta / block-end / usage / finish), the
 *    `BlockAssembler`, the `LlmError` code taxonomy, `assertUsableApiKey`
 *    and `attributionHeaders`. It ships no HTTP transport — the official
 *    transport adapter (`@deepseek-ai/dsh-llm-deepseek`) is wired into the
 *    harness runtime and cannot be installed standalone. So this provider
 *    subclasses `LlmAdapter` and supplies the transport itself, translating
 *    the wire into official chunks with the exact mappings the official
 *    adapter implements (usage cache split, finish-reason vocabulary, HTTP
 *    error codes) and assembling the plan through the official
 *    `BlockAssembler`.
 *
 * 2. Direct path (fallback). When the optional package is absent
 *    (`npm install --omit=optional`), the same wire contract is consumed by
 *    a zero-dependency accumulator. The CLI degrades gracefully; behavior
 *    and diagnostics stay identical.
 *
 * Wire-format references: DeepSeek API docs (create-chat-completion,
 * thinking_mode, first-token-latency) — the same source of truth the
 * harness adapter documents.
 */

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_TIMEOUT_MS = 120_000;
/** Planning output is a small JSON document; cap the generation budget. */
const PLAN_MAX_TOKENS = 8192;

export interface DeepSeekStreamResult {
  text: string;
  reasoning: string;
  usage: Record<string, unknown> | null;
}

/* ------------------------------------------------------------------ *
 * Shared SSE wire layer — both paths consume the same reader.
 * ------------------------------------------------------------------ */

/**
 * Yield every SSE `data:` payload in stream order, including the `[DONE]`
 * sentinel; the generator stops there so anything after `[DONE]` is never
 * observed. SSE comments (`:`), blank separators, and non-data fields are
 * ignored. Chunk boundaries anywhere are tolerated (multi-byte safe via
 * streaming TextDecoder).
 */
async function* iterateSsePayloads(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
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
      if (payload === "[DONE]") return;
    }
  }
}

/**
 * Consume an OpenAI-compatible SSE chat-completions stream and accumulate
 * the assistant text (direct fallback path). Tolerates `reasoning_content`
 * deltas (thinking models — collected separately, never mixed into the plan
 * text), usage-only trailing chunks, and streams that close without
 * `[DONE]` once content has arrived.
 */
export async function collectStreamText(
  body: ReadableStream<Uint8Array>,
): Promise<DeepSeekStreamResult> {
  let text = "";
  let reasoning = "";
  let usage: Record<string, unknown> | null = null;

  const handleData = (payload: string): void => {
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

  for await (const payload of iterateSsePayloads(body)) {
    if (payload === "[DONE]") return { text, reasoning, usage };
    handleData(payload);
  }
  // Stream ended without [DONE] — accept what we have if any text arrived,
  // otherwise the response was empty/invalid.
  if (text.length === 0 && reasoning.length === 0) {
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

/* ------------------------------------------------------------------ *
 * @deepseek-ai/dsh-llm seam (optionalDependency, dynamically imported).
 * ------------------------------------------------------------------ */

export const DSH_LLM_MISSING =
  'Optional package "@deepseek-ai/dsh-llm" is not installed — the DeepSeek provider falls back to its built-in streaming client. Install it with: npm i @deepseek-ai/dsh-llm';

/**
 * Structural subset of the dsh-llm runtime surface Tau relies on. Mirrors
 * the official adapter's own imports from `@deepseek-ai/dsh-llm`.
 */
export interface DshLlmBundle {
  /** Abstract adapter base class — the documented extension point. */
  LlmAdapter: abstract new () => LlmAdapterType;
  /** Canonical chunk-to-message assembler. */
  BlockAssembler: new () => BlockAssemblerType;
  /** Typed error with a stable machine-routable `code`. */
  LlmError: new (
    message: string,
    code: string,
    options?: {
      cause?: unknown;
      status?: number;
      providerRetryAfterMs?: number;
      requestId?: string;
    },
  ) => Error;
  /** Judge one supplied credential; never echoes the secret. */
  assertUsableApiKey: (raw: string, pkg: string, ref: string) => string;
  /** Standard `User-Agent` attribution headers for provider requests. */
  attributionHeaders: (identity?: AppIdentity) => Record<string, string>;
  /** Brand a provider-issued tool-call id (nominal typing policy). */
  CallId: (id: string) => CallId;
  EMPTY_RESPONSE_CODE: string;
  QUOTA_EXCEEDED_CODE: string;
  CONTEXT_WINDOW_EXCEEDED_CODE: string;
  isQuotaExceededError: (detail: unknown) => boolean;
  isContextWindowExceededError: (detail: unknown) => boolean;
}

let cachedDsh: DshLlmBundle | null | undefined;
let dshLoaderOverride: (() => Promise<DshLlmBundle | null>) | undefined;

/** Load the dsh-llm harness seam dynamically; null when absent (never throws). */
export async function loadDshLlm(): Promise<DshLlmBundle | null> {
  if (dshLoaderOverride) return dshLoaderOverride();
  if (cachedDsh !== undefined) return cachedDsh;
  try {
    // Variable specifier on purpose: the bundler cannot resolve it, so the
    // package stays external (see tsdown.config.ts deps.neverBundle) and is
    // resolved from node_modules at runtime.
    const spec = "@deepseek-ai/dsh-llm";
    const mod = (await import(spec)) as unknown as Partial<DshLlmBundle>;
    if (
      typeof mod.LlmAdapter !== "function" ||
      typeof mod.BlockAssembler !== "function" ||
      typeof mod.LlmError !== "function" ||
      typeof mod.assertUsableApiKey !== "function" ||
      typeof mod.attributionHeaders !== "function" ||
      typeof mod.CallId !== "function"
    ) {
      throw new Error("unexpected dsh-llm shape");
    }
    cachedDsh = mod as DshLlmBundle;
  } catch {
    cachedDsh = null;
  }
  return cachedDsh;
}

export function resetDshLlmCache(): void {
  cachedDsh = undefined;
}

/** Test seam: force the harness seam on/off without touching node_modules. */
export function setDshLlmLoaderForTests(loader?: () => Promise<DshLlmBundle | null>): void {
  dshLoaderOverride = loader;
}

let cachedIdentity: AppIdentity | undefined;

/**
 * Tau's public provider-request identity (official attribution contract:
 * every adapter sends `attributionHeaders()` on every request, and nothing
 * may suppress it). Public facts only — no secrets, paths, or per-user data.
 */
function tauIdentity(): AppIdentity {
  if (!cachedIdentity) {
    cachedIdentity = {
      product: "tau",
      version: readPackageVersion(),
      url: "https://github.com/Z-Yun-H/Tau",
    };
  }
  return cachedIdentity;
}

/**
 * Read Tau's own version for attribution. Walks up from this module until
 * the project package.json is found: from src/ the depth differs from the
 * bundled dist/ layout, so a fixed relative path cannot serve both.
 */
function readPackageVersion(): string {
  const requireFromHere = createRequire(import.meta.url);
  for (let depth = 1; depth <= 5; depth++) {
    try {
      const pkg = requireFromHere(`${"../".repeat(depth)}package.json`) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === "tau-tool") return pkg.version ?? "0.0.0-dev";
    } catch {
      /* keep walking */
    }
  }
  return "0.0.0-dev";
}

/* ------------------------------------------------------------------ *
 * Wire → harness translation, mirroring the official adapter's
 * translate/mapUsage/mapFinishReason/httpErrorCode verbatim.
 * ------------------------------------------------------------------ */

/**
 * Official usage mapping. DeepSeek folds cache hits into `prompt_tokens`,
 * but harness token counts are DISJOINT, so cache reads are subtracted out
 * of `inputTokens` and reported separately. Legacy
 * `prompt_cache_hit_tokens` is honored when the `prompt_tokens_details`
 * shape is absent.
 */
export function mapWireUsage(usage: Record<string, unknown>): TokenUsage {
  const record = usage as {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    prompt_cache_hit_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  const cacheRead = record.prompt_tokens_details?.cached_tokens ?? record.prompt_cache_hit_tokens;
  const reasoning = record.completion_tokens_details?.reasoning_tokens;
  return {
    inputTokens: (record.prompt_tokens ?? 0) - (cacheRead ?? 0),
    outputTokens: record.completion_tokens ?? 0,
    ...(cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {}),
    ...(reasoning !== undefined ? { reasoningTokens: reasoning } : {}),
  };
}

/**
 * Official finish-reason mapping: `stop`, `tool_calls`, `length` map onto
 * the harness vocabulary; unrecognized values (content_filter, …) become an
 * `error` finish with the uppercased value as the failure code.
 */
export function mapWireFinishReason(reason: string): FinishReason {
  switch (reason) {
    case "stop":
      return { kind: "stop" };
    case "tool_calls":
      return { kind: "tool-calls" };
    case "length":
      return { kind: "max-tokens" };
    default:
      return {
        kind: "error",
        failure: { message: `model stopped: ${reason}`, code: reason.toUpperCase() },
      };
  }
}

/**
 * Official HTTP status → stable `LlmError` code mapping, including the
 * shared quota / context-window classifiers over the provider error detail.
 */
export function httpErrorCode(
  llm: Pick<
    DshLlmBundle,
    | "isQuotaExceededError"
    | "isContextWindowExceededError"
    | "QUOTA_EXCEEDED_CODE"
    | "CONTEXT_WINDOW_EXCEEDED_CODE"
  >,
  status: number,
  error?: { code?: unknown; type?: unknown; message?: unknown },
): string {
  if (status === 401 || status === 403) return "AUTH";
  const detail = [error?.code, error?.type, error?.message].filter(Boolean).join(" ");
  if (llm.isQuotaExceededError(detail)) return llm.QUOTA_EXCEEDED_CODE;
  if (status === 429) return "RATE_LIMIT";
  if (status === 400) {
    if (llm.isContextWindowExceededError(detail)) return llm.CONTEXT_WINDOW_EXCEEDED_CODE;
    return "INVALID_REQUEST";
  }
  if (status >= 500) return "SERVER";
  return `HTTP_${status}`;
}

/** Official Retry-After parsing: delta-seconds or an HTTP-date. */
function providerRetryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (/^\d+$/.test(value)) {
    const delay = Number(value) * 1000;
    return Number.isFinite(delay) && delay > 0 ? delay : undefined;
  }
  const delay = Date.parse(value) - Date.now();
  return Number.isFinite(delay) && delay > 0 ? delay : undefined;
}

/** Official provider request id capture for diagnostics. */
function requestIdOf(headers: Headers): string | undefined {
  const value = headers.get("x-request-id") ?? headers.get("x-deepseek-request-id");
  return value === null || value.length === 0 ? undefined : value;
}

/**
 * Consume SSE data payloads (ending with `[DONE]`) and yield official
 * `StreamChunk`s. Blocks open lazily on the first non-empty delta
 * (reasoning before content, matching the official per-choice order);
 * `block-end`s, `usage`, and `finish` are all deferred to the `[DONE]`
 * sentinel. A `stop` (or absent) finish with no opened blocks is a
 * degenerate provider completion and maps to an `EMPTY_RESPONSE` error
 * finish instead of a successful empty message. Malformed JSON payloads
 * abort the stream with `MALFORMED_RESPONSE`; a stream that ends without
 * `[DONE]` aborts with `STREAM_CLOSED`.
 */
async function* translateWireToChunks(
  payloads: AsyncIterable<string>,
  llm: DshLlmBundle,
): AsyncIterable<StreamChunk> {
  type OpenBlock = {
    index: number;
    kind: "text" | "reasoning" | "tool-call";
    text: string;
    callId?: string;
    name?: string;
  };
  let nextIndex = 0;
  let textBlock: OpenBlock | undefined;
  let reasoningBlock: OpenBlock | undefined;
  const toolBlocks = new Map<number, OpenBlock>();
  const order: OpenBlock[] = [];
  let pendingFinish: FinishReason | undefined;
  let pendingUsage: TokenUsage | undefined;

  const open = (kind: OpenBlock["kind"]): OpenBlock => {
    const block: OpenBlock = { index: nextIndex++, kind, text: "" };
    order.push(block);
    return block;
  };

  for await (const payload of payloads) {
    if (payload === "[DONE]") {
      for (const block of order) {
        let closed: ContentBlock;
        switch (block.kind) {
          case "text":
            closed = { type: "text", text: block.text };
            break;
          case "reasoning":
            closed = { type: "reasoning", text: block.text };
            break;
          case "tool-call":
            closed = {
              type: "tool-call",
              id: llm.CallId(block.callId ?? ""),
              name: block.name ?? "",
              arguments: block.text,
            };
            break;
        }
        yield { type: "block-end", index: block.index, block: closed };
      }
      if (pendingUsage) yield { type: "usage", usage: pendingUsage };
      const reason = pendingFinish ?? { kind: "stop" };
      yield {
        type: "finish",
        reason:
          reason.kind === "stop" && order.length === 0
            ? {
                kind: "error",
                failure: {
                  message: "model returned a completed response with no content",
                  code: llm.EMPTY_RESPONSE_CODE,
                },
              }
            : reason,
      };
      return;
    }

    let chunk: {
      choices?: Array<{
        delta?: {
          content?: string | null;
          reasoning_content?: string | null;
          tool_calls?: Array<{
            index?: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
        finish_reason?: string | null;
      }>;
      usage?: Record<string, unknown>;
    };
    try {
      chunk = JSON.parse(payload);
    } catch {
      throw new llm.LlmError(
        `malformed SSE payload: ${payload.slice(0, 120)}`,
        "MALFORMED_RESPONSE",
      );
    }

    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta;
      const reasoning = delta?.reasoning_content;
      if (typeof reasoning === "string" && reasoning.length > 0) {
        if (!reasoningBlock) {
          reasoningBlock = open("reasoning");
          yield { type: "block-start", index: reasoningBlock.index, blockType: "reasoning" };
        }
        reasoningBlock.text += reasoning;
        yield { type: "reasoning-delta", index: reasoningBlock.index, text: reasoning };
      }
      const content = delta?.content;
      if (typeof content === "string" && content.length > 0) {
        if (!textBlock) {
          textBlock = open("text");
          yield { type: "block-start", index: textBlock.index, blockType: "text" };
        }
        textBlock.text += content;
        yield { type: "text-delta", index: textBlock.index, text: content };
      }
      for (const call of delta?.tool_calls ?? []) {
        const key = call.index ?? 0;
        let block = toolBlocks.get(key);
        if (!block) {
          block = open("tool-call");
          toolBlocks.set(key, block);
          yield { type: "block-start", index: block.index, blockType: "tool-call" };
        }
        if (call.id !== undefined) block.callId = call.id;
        if (call.function?.name !== undefined) block.name = call.function.name;
        const fragment = call.function?.arguments ?? "";
        block.text += fragment;
        yield {
          type: "tool-call-delta",
          index: block.index,
          id: llm.CallId(block.callId ?? ""),
          ...(block.name !== undefined ? { name: block.name } : {}),
          argumentsDelta: fragment,
        };
      }
      if (typeof choice.finish_reason === "string") {
        pendingFinish = mapWireFinishReason(choice.finish_reason);
      }
    }
    if (chunk.usage) pendingUsage = mapWireUsage(chunk.usage);
  }
  throw new llm.LlmError("SSE payload stream ended without [DONE]", "STREAM_CLOSED");
}

/**
 * Hand-built one-shot user turn. `GenerateOptions` explicitly permits any
 * message list for hand-built calls; the adapter serializes role + text
 * blocks only, so a minimal structural value suffices here.
 */
function userTextMessage(text: string): Message {
  return {
    id: "tau-plan-user-turn",
    role: "user",
    content: [{ type: "text", text }],
    source: { kind: "user" },
  } as unknown as Message;
}

/** Adapter connection facts, resolved per plan() call from Tau's config. */
export interface HarnessConnection {
  baseUrl: () => string;
  apiKey: () => string | undefined;
}

/**
 * Build the harness adapter: a genuine `LlmAdapter` whose transport
 * implements the official DeepSeek wire contract. Usable standalone (Tau's
 * provider registry) or registrable into any DeepSeek Harness host via
 * `ctx.llm.registerAdapter`.
 */
export function createDeepSeekHarnessAdapter(
  llm: DshLlmBundle,
  connection: HarnessConnection,
): LlmAdapterType {
  return new (class extends llm.LlmAdapter {
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      const body = {
        model: options.model,
        messages: [
          ...(options.system ? [{ role: "system", content: options.system }] : []),
          ...options.messages.map((message) => ({
            role: message.role,
            content: message.content
              .filter((block): block is { type: "text"; text: string } => block.type === "text")
              .map((block) => block.text)
              .join(""),
          })),
        ],
        stream: true,
        stream_options: { include_usage: true },
        ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
        ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
        ...(options.stop?.length ? { stop: options.stop } : {}),
      };
      const apiKey = connection.apiKey() ?? "";
      const headers: Record<string, string> = {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "text/event-stream",
        ...llm.attributionHeaders(tauIdentity()),
      };
      const signal = options.signal ?? undefined;

      let response: Response;
      try {
        // Node 20+ has global fetch; read it lazily so tests can stub it.
        const doFetch = globalThis.fetch;
        response = await doFetch(`${connection.baseUrl()}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal,
        });
      } catch (error) {
        if (signal?.aborted) throw error; // official: caller aborts rethrow
        throw new llm.LlmError(
          `DeepSeek API request to ${connection.baseUrl()} failed`,
          "TRANSPORT",
          { cause: error },
        );
      }

      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        let providerError: { code?: unknown; type?: unknown; message?: unknown } | undefined;
        try {
          providerError = (JSON.parse(bodyText) as { error?: typeof providerError }).error;
        } catch {
          /* keep raw body text */
        }
        const delay = providerRetryAfterMs(response.headers.get("retry-after"));
        const id = requestIdOf(response.headers);
        throw new llm.LlmError(
          apiErrorMessage(response.status, bodyText),
          httpErrorCode(llm, response.status, providerError),
          {
            status: response.status,
            ...(delay === undefined ? {} : { providerRetryAfterMs: delay }),
            ...(id === undefined ? {} : { requestId: id }),
          },
        );
      }
      if (!response.body) {
        throw new llm.LlmError("DeepSeek API returned no response body", "EMPTY_RESPONSE");
      }
      yield* translateWireToChunks(iterateSsePayloads(response.body), llm);
    }
  })();
}

/* ------------------------------------------------------------------ *
 * Provider — Tau's AIProvider surface over the two paths.
 * ------------------------------------------------------------------ */

/** Render a harness failure finish as an actionable CLI error. */
function harnessFailureMessage(failure: LlmFailure): string {
  const hint =
    failure.code === "AUTH" || failure.code === "INVALID_CREDENTIAL"
      ? " (check DEEPSEEK_API_KEY)"
      : failure.code === "RATE_LIMIT" || failure.code === "QUOTA_EXCEEDED"
        ? " (rate limited or out of balance)"
        : failure.code === "SERVER"
          ? " (DeepSeek server error, retry later)"
          : failure.code === "TIMEOUT"
            ? " (raise providers.deepseek.timeoutMs if your model is slow)"
            : "";
  return `DeepSeek request failed [${failure.code}]${hint}: ${failure.message}`;
}

/** DeepSeek planning provider over the official streaming wire format. */
export class DeepSeekProvider implements AIProvider {
  readonly name = "deepseek";
  readonly label = "DeepSeek";

  /** Config key (`tau provider set-key deepseek`) wins; env var is the fallback. */
  apiKey(): string | undefined {
    const fromConfig = loadConfig().providers["deepseek"]?.["apiKey"];
    if (typeof fromConfig === "string" && fromConfig.trim().length > 0) return fromConfig;
    return process.env.DEEPSEEK_API_KEY;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey());
  }

  unavailableReason(): string {
    return (
      "Missing DeepSeek API key — run `tau provider set-key deepseek <key>` " +
      "or set the DEEPSEEK_API_KEY environment variable."
    );
  }

  private baseUrl(): string {
    return String(loadConfig().providers["deepseek"]?.["baseUrl"] ?? DEFAULT_BASE_URL).replace(
      /\/$/,
      "",
    );
  }

  /**
   * Live model discovery: GET {baseUrl}/models (OpenAI-compatible shape,
   * documented in DeepSeek's "List Models" endpoint). Auth/network failures
   * throw — the model-catalog service owns caching and degradation.
   */
  async listModels(): Promise<ModelInfo[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    timer.unref?.();
    try {
      const doFetch = globalThis.fetch;
      const response = await doFetch(`${this.baseUrl()}/models`, {
        headers: { authorization: `Bearer ${this.apiKey() ?? ""}` },
        signal: controller.signal,
      });
      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        throw new Error(apiErrorMessage(response.status, bodyText));
      }
      const parsed = (await response.json()) as {
        data?: Array<{ id?: string; owned_by?: string }>;
      };
      return (parsed.data ?? [])
        .filter((entry): entry is { id: string; owned_by?: string } => typeof entry.id === "string")
        .map((entry) => ({ id: entry.id, ...(entry.owned_by ? { ownedBy: entry.owned_by } : {}) }));
    } finally {
      clearTimeout(timer);
    }
  }

  private timeoutMs(): number {
    const raw = loadConfig().providers["deepseek"]?.["timeoutMs"];
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
  }

  async plan(ctx: PlanningContext): Promise<Plan> {
    // Dynamic import avoids the registry -> provider -> models -> registry
    // ESM initialization cycle (see the note in providers/openai.ts).
    const { resolveModel } = await import("../models.js");
    // Model resolution first: it fails fast with an actionable message when
    // nothing is selected, before any network traffic happens.
    const { model } = await resolveModel(this.name);
    const llm = await loadDshLlm();
    if (llm) return this.planViaHarness(llm, ctx, model);
    return this.planDirect(ctx, model);
  }

  /**
   * Harness path: official `LlmAdapter` transport + `BlockAssembler`
   * assembly. `assertUsableApiKey` judges the credential before any request
   * (trimmed, printable-ASCII, secret never echoed).
   */
  private async planViaHarness(
    llm: DshLlmBundle,
    ctx: PlanningContext,
    model: string,
  ): Promise<Plan> {
    // Official contract: use the returned (trimmed) key, never the raw value.
    const apiKey = llm.assertUsableApiKey(this.apiKey() ?? "", "tau", "DEEPSEEK_API_KEY");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs());
    timer.unref?.();

    const adapter = createDeepSeekHarnessAdapter(llm, {
      baseUrl: () => this.baseUrl(),
      apiKey: () => apiKey,
    });
    const assembler = new llm.BlockAssembler();
    try {
      const options: GenerateOptions = {
        provider: this.name,
        model,
        system: buildSystemPrompt(ctx),
        messages: [userTextMessage(ctx.intent)],
        maxTokens: PLAN_MAX_TOKENS,
        signal: controller.signal,
      };
      for await (const chunk of adapter.stream(options)) assembler.push(chunk);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          `DeepSeek request timed out after ${Math.round(this.timeoutMs() / 1000)}s — raise providers.deepseek.timeoutMs if your model is slow.`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }

    const finish = assembler.finish;
    if (finish.kind === "error" || finish.kind === "aborted") {
      throw new Error(harnessFailureMessage(finish.failure));
    }
    const text = assembler
      .blocks()
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("");
    return validatePlanResponse(text);
  }

  /**
   * Direct fallback path: identical wire contract, zero dependencies, used
   * when the optional harness seam is not installed. See DSH_LLM_MISSING.
   */
  private async planDirect(ctx: PlanningContext, model: string): Promise<Plan> {
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
