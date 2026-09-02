# @tau/ai

The pluggable AI provider layer: providers propose plans, they never execute
anything. Ships with mock (offline demo), ollama, openai, deepseek (official
`@deepseek-ai/dsh-llm` streaming harness with a zero-dependency fallback) and
zai providers, plus the API-key driven model catalog service.

## Public API

Everything is exported from the package barrel (`src/index.ts`):

- **Prompt & schema** (`src/prompt.ts`) — `buildSystemPrompt()`,
  `planningContext()`, `validatePlanResponse()`, the zod `planSchema` /
  `planStepSchema`
- **Provider registry** (`src/registry.ts`) — `registerProvider()`,
  `resolveProvider()`, `getProvider()`, `providerNames()`, `resetProviders()`
- **Provider classes** (`src/providers/`) — `MockProvider`, `OllamaProvider`,
  `OpenAIProvider`, `DeepSeekProvider`, `ZaiProvider`. Mock is self-contained
  (zero-network, no shared utility). `OpenAIProvider` and `DeepSeekProvider`
  extend `BaseHttpProvider` (`src/providers/base.ts`) which owns the shared
  key-auth scaffolding (apiKey resolution, baseUrl/timeout defaults,
  isAvailable, unavailableReason, listModels). `OllamaProvider` implements
  `AIProvider` directly (local-server probe, no key). `DeepSeekProvider`
  overrides `listModels()` to keep its test-pinned error format and keeps its
  own SSE-streaming wire client in `plan()`. `ZaiProvider` routes through the
  optional `z-ai-web-dev-sdk` peer. The shared `chatJSON` helper lives in
  `src/providers/http.ts`: non-2xx and network failures surface as a typed
  `ProviderHttpError` (status, ≤300-char body slice, retryable verdict);
  transient failures (429/500/502/503/504, connection errors) retry with
  bounded exponential backoff + jitter honoring a numeric `Retry-After`
  (capped at 10 s) — other 4xx and timeout aborts never retry. The timeout
  budget applies per attempt; error messages keep the test-pinned
  `HTTP <status>` prefix.
- **Model catalog** (`src/models.ts`) — `refreshProviderModels()`,
  `cachedModels()`, `resolveModel()`, `isCatalogStale()`, `MODELS_TTL_MS`
  (24 h cache; providers implement optional `listModels()`)

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
