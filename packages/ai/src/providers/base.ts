/**
 * BaseHttpProvider — shared scaffolding for OpenAI-compatible HTTP providers.
 *
 * The mock provider (./mock.ts) is self-contained and never imports from here
 * (AGENTS/ai-integration.md: "mock ... hosts NO shared utility"). Streaming
 * providers (./deepseek.ts) keep their own SSE wire client because their
 * semantics differ from chatJSON's non-streaming POST. The Z.ai provider
 * (./zai.ts) routes through the optional z-ai-web-dev-sdk peer, not raw HTTP.
 *
 * What this base consolidates (AGENTS/ai-integration.md "Adding a provider"):
 * - API key resolution: config-first (`providers.<name>.apiKey`) → env fallback
 * - Base URL resolution: `providers.<name>.baseUrl` → subclass default
 * - Timeout resolution: `providers.<name>.timeoutMs` → subclass default
 * - `isAvailable()` = `Boolean(this.apiKey())` (key-based providers)
 * - `unavailableReason()` template with the provider name + env var
 * - `listModels()`: GET `{baseUrl}/models` with Bearer auth, OpenAI-compatible
 *   shape `{ data: [{ id, owned_by }] }`. Throws on auth/network failure —
 *   the model-catalog service owns caching and degradation.
 *
 * Subclasses override `plan()` (wire-specific) and may override
 * `listModels()` when the discovery endpoint differs (ollama hits
 * `/api/tags`, anthropic `/models?limit=100`, gemini `/models?pageSize=100`).
 * Streaming providers share the wire folding in `../chat-stream.ts`
 * (v0.5.0); `planStream()` relays reasoning/text/usage events and resolves
 * to the same validated Plan as `plan()`.
 */

import { loadConfig } from "@tau/core";
import type { AIProvider, ModelInfo, PlanningContext, Plan, ProviderUsage } from "@tau/core";

/** Subclass contract: identity + the wire-specific plan() + defaults. */
export interface HttpProviderConfig {
  /** Registry key, e.g. "openai" | "ollama" — used for config lookup. */
  readonly name: string;
  /** Human-readable label for CLI display. */
  readonly label: string;
  /** Environment variable that carries the API key as a fallback. */
  readonly envKey: string;
  /** Default base URL when `providers.<name>.baseUrl` is unset. */
  readonly defaultBaseUrl: string;
  /** Default request timeout in ms when `providers.<name>.timeoutMs` is unset. */
  readonly defaultTimeoutMs: number;
}

/**
 * Shared base for OpenAI-compatible HTTP providers. Subclasses implement
 * `plan()` (wire-specific request/response shaping) and may override
 * `listModels()` when the discovery endpoint differs from `{baseUrl}/models`.
 */
export abstract class BaseHttpProvider implements AIProvider {
  abstract readonly name: string;
  abstract readonly label: string;

  /** Subclass-provided configuration (env key, defaults). */
  protected abstract readonly config: HttpProviderConfig;

  /** API key: config-first, env fallback. Empty/whitespace config values are ignored. */
  apiKey(): string | undefined {
    const fromConfig = loadConfig().providers[this.name]?.["apiKey"];
    if (typeof fromConfig === "string" && fromConfig.trim().length > 0) return fromConfig;
    return process.env[this.config.envKey];
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.apiKey());
  }

  unavailableReason(): string {
    return (
      `Missing ${this.label} API key — run \`tau provider set-key ${this.name} <key>\` ` +
      `or set the ${this.config.envKey} environment variable.`
    );
  }

  /** Base URL with trailing slash trimmed. */
  protected baseUrl(): string {
    return String(
      loadConfig().providers[this.name]?.["baseUrl"] ?? this.config.defaultBaseUrl,
    ).replace(/\/$/, "");
  }

  /** Request timeout in ms (finite positive config value, else subclass default). */
  protected timeoutMs(): number {
    const raw = loadConfig().providers[this.name]?.["timeoutMs"];
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : this.config.defaultTimeoutMs;
  }

  /**
   * Live model discovery: GET `{baseUrl}/models` (OpenAI-compatible shape).
   * Auth/network failures throw — the model-catalog service owns caching and
   * degradation (AGENTS/ai-integration.md "Model discovery and selection").
   * Override in subclasses whose discovery endpoint differs (ollama → /api/tags).
   */
  async listModels(): Promise<ModelInfo[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    timer.unref?.();
    try {
      const doFetch = globalThis.fetch;
      const res = await doFetch(`${this.baseUrl()}/models`, {
        headers: { authorization: `Bearer ${this.apiKey() ?? ""}` },
        signal: controller.signal,
      });
      if (!res.ok) {
        const detail = (await res.text().catch(() => "")).slice(0, 200);
        throw new Error(`${this.label} model listing failed (HTTP ${res.status}): ${detail}`);
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

  /** Wire-specific plan synthesis — subclasses implement. */
  abstract plan(ctx: PlanningContext): Promise<Plan>;

  /**
   * Token usage of the MOST RECENT AI call this provider made (plan or
   * reflect), undefined when the provider reports none. Observability-only
   * (issue #98): read right after the awaited call — Tau's front doors are
   * sequential per process, so there is no cross-call ambiguity. Base field
   * lives here so subclasses share one capture convention; providers that
   * never capture just leave it undefined.
   */
  lastUsage: ProviderUsage | undefined = undefined;
}
