# @tau/ai

The pluggable AI provider layer: providers propose plans, they never execute
anything. Ships with mock (offline demo), ollama, openai, deepseek (official
`@deepseek-ai/dsh-llm` streaming harness with a zero-dependency fallback),
zai, anthropic (Claude Messages API) and gemini (Google Generative Language
REST) providers, plus the API-key driven model catalog service and the
unified streaming wire layer (v0.5.0).

## Public API

Everything is exported from the package barrel (`src/index.ts`):

- **Prompt & schema** (`src/prompt.ts`) — `buildSystemPrompt()`,
  `planningContext()`, `validatePlanResponse()`, the zod `planSchema` /
  `planStepSchema`
- **Streaming wire layer** (`src/chat-stream.ts`, v0.5.0) —
  `consumeOpenAiCompatibleStream()`, `consumeAnthropicStream()`,
  `consumeGeminiStream()`, `consumeOllamaStream()`: each folds its wire
  (SSE or NDJSON) into the provider-agnostic `ProviderStreamEvent` protocol
  from `@tau/core` (`reasoning_delta` / `text_delta` / `usage`). Streaming
  never weakens the plan contract — assembled text goes through the same
  `validatePlanResponse` gate.
- **Provider registry** (`src/registry.ts`) — `registerProvider()`,
  `resolveProvider()`, `getProvider()`, `providerNames()`, `resetProviders()`
- **Provider classes** (`src/providers/`) — `MockProvider`, `OllamaProvider`,
  `OpenAIProvider`, `DeepSeekProvider`, `ZaiProvider`, `AnthropicProvider`,
  `GeminiProvider`. Mock is self-contained (zero-network, no shared utility)
  and its `planStream()` emits a deterministic event sequence for offline
  demos and screenshots. `OpenAIProvider`, `DeepSeekProvider`,
  `AnthropicProvider` and `GeminiProvider` extend `BaseHttpProvider`
  (`src/providers/base.ts`) which owns the shared key-auth scaffolding
  (apiKey resolution, baseUrl/timeout defaults, isAvailable,
  unavailableReason, listModels). Providers implement the OPTIONAL
  `planStream(ctx, onEvent)` capability: reasoning/text deltas relay live
  (thinking traces stay separate from plan text) while the returned Plan is
  identical to `plan()`. `ZaiProvider` routes through the optional
  `z-ai-web-dev-sdk` peer and degrades planStream to one honest single-shot
  text event. The shared `chatJSON` helper lives in `src/providers/http.ts`:
  non-2xx and network failures surface as a typed `ProviderHttpError`
  (status, ≤300-char body slice, retryable verdict); transient failures
  (429/500/502/503/504, connection errors) retry with bounded exponential
  backoff + jitter honoring a numeric `Retry-After` (capped at 10 s) — other
  4xx and timeout aborts never retry. The timeout budget applies per
  attempt; error messages keep the test-pinned `HTTP <status>` prefix.
- **Model catalog** (`src/models.ts`) — `refreshProviderModels()`,
  `cachedModels()`, `resolveModel()`, `isCatalogStale()`, `MODELS_TTL_MS`
  (24 h cache; providers implement optional `listModels()`)
- **Usage normalization** (`src/usage.ts`) — `normalizeUsage()` folds the
  OpenAI (`prompt_tokens`/`completion_tokens`), DeepSeek harness
  (`inputTokens`/`outputTokens`), Gemini (`promptTokenCount`/
  `candidatesTokenCount`) and Ollama (`prompt_eval_count`/`eval_count`)
  wire shapes into `ProviderUsage`; `formatUsage()` renders the compact
  log form.

Model selection is catalog-driven: there are no hardcoded default models —
configure a key (`tau provider set-key`), refresh the catalog, then pick a
model (`tau provider use`). Providers lazily import `models.ts` inside
`plan()` to avoid a registry ↔ models import cycle (see
[AGENTS/ai-integration.md](../../AGENTS/ai-integration.md)).

## Dependencies

- Runtime: `zod`; optional `@deepseek-ai/dsh-llm` (dynamic import, never
  bundled)
- Workspace: `@tau/core`, `@tau/tools`

## Development

```bash
pnpm --filter @tau/ai build
pnpm test
```

Rulebooks: [AGENTS/ai-integration.md](../../AGENTS/ai-integration.md) (the
contract for adding a provider), [docs/plugins.md](../../docs/plugins.md) for
MCP integration.
