# AGENTS/ai-integration.md — providers, prompts, and the safety boundary

## Provider interface (src/types.ts AIProvider)

```ts
interface AIProvider {
  readonly name: string; // registry key: "mock" | "ollama" | "openai" | "deepseek" | "zai"
  readonly label: string; // CLI display
  isAvailable(): Promise<boolean>;
  unavailableReason?(): string;
  plan(ctx: PlanningContext): Promise<Plan>;
  listModels?(): Promise<ModelInfo[]>; // optional live model discovery
}
```

Registration: `src/ai/registry.ts registerProvider(...)`. `DEFAULT_CONFIG.providers`
in `src/config/store.ts` carries NO model defaults — never add one.

Selection precedence: `--provider` flag > `TAU_PROVIDER` env > `config.provider`

> mock fallback. An unknown name silently falls back to mock — intentional:
> the CLI must never hard-fail on config drift.

## Model discovery and selection (src/ai/models.ts)

- `listModels()` is OPTIONAL: implement it only when the backend has a real
  discovery endpoint (`GET /models` for openai/deepseek, `/api/tags` for
  ollama; mock serves a fake catalog for offline demos; zai deliberately
  omits it). It must THROW on auth/network failure — caching and degradation
  belong to the catalog service, not the provider.
- The catalog service (`refreshProviderModels`) persists ids in
  `providers.<name>.availableModels` + `modelsRefreshedAt` (24 h TTL,
  `MODELS_TTL_MS`). Serving rules: fresh cache → cache (zero network); stale
  or forced → live; live failure with cache → cache + warning; live failure
  without cache → throw.
- The UX contract: configuring a key (`tau provider set-key`) immediately
  auto-refreshes the catalog, so `tau provider use` always picks from real,
  current models. A failed refresh degrades to the cache and NEVER fails the
  `set-key` command itself.
- Request-time resolution (`resolveModel` in src/ai/models.ts): explicit
  `providers.<name>.model` wins; a catalog with exactly one model is
  auto-selected and persisted; anything else throws an error naming the exact
  fix (`tau provider use <name>` or `tau config set providers.<name>.model
<id>`). Never reintroduce hardcoded model fallbacks.
- Providers load `models.ts` lazily (`await import("../models.js")`) inside
  `plan()` — a static import would create a registry → provider → models →
  registry cycle and break ESM initialization.
- API key resolution: `providers.<name>.apiKey` (config) FIRST, env var
  (`DEEPSEEK_API_KEY` / `OPENAI_API_KEY`) as fallback. `set-key` stores into
  config; `saveConfig` chmods the file 0600. CLI output always masks keys
  (`maskSecret` / `redactConfig`) — never print a full key.
- Non-interactive sessions must never hang on stdin: `tau provider use <p>`
  without a model only opens the picker on a TTY; otherwise it prints the
  explicit-model hint.

## The plan contract

Providers answer STRICT JSON:

```json
{
  "explanation": "string",
  "steps": [{ "kind": "tool", "tool": "file.find", "args": {}, "reason": "..." }],
  "selfAssessedRisk": "low|medium|high"
}
```

`validatePlanResponse()` (src/ai/prompt.ts) is tolerant about WRAPPING
(code fences, prose around JSON) and strict about CONTENT (zod `.strict()`).
Changes to the schema must update: planSchema + reviewPlan expectations +
mock provider + tests + this file + README example.

## System prompt (buildSystemPrompt)

- Injects the REAL tool catalog (renderToolCatalog) and skill catalog — the
  planner can only propose tools that actually exist, and the reviewer
  independently enforces that. Keep both sides in sync.
- The catalog also includes MCP plugin tools: `src/cli/ask.ts` calls
  `registerPluginTools()` BEFORE building the planning context, so
  `plugin.<name>.<tool>` entries are first-class planner targets (and the
  reviewer grades them via their intrinsic `medium` risk). Plugin failures
  degrade to warnings and shrink the catalog, never break the run.
- Explicit rules: prefer tools over shell, prefer dry-run first, no invented
  tool names, ≤10 steps, JSON only.
- Keep the prompt deterministic for a given catalog (no timestamps, no
  randomness) so tests can assert on it.

## Adding a provider — checklist

1. `src/ai/providers/<name>.ts` implementing AIProvider (look at openai.ts
   for the HTTP pattern; ollama.ts for local-server availability probing).
2. Register in `registry.ts`; add config defaults in `store.ts`.
3. `isAvailable()` must be CHEAP and never prompt; `unavailableReason()`
   explains exactly what to install/export.
4. Tests: request shaping + response parsing with a mocked `chatJSON`/fetch.
   Never hit real endpoints in CI.
5. Update README (both languages) provider table + `tau config list` output
   if it changes.

## Provider notes — deepseek (harness adapter + built-in fallback)

`src/ai/providers/deepseek.ts` speaks the official DeepSeek
chat-completions STREAMING wire contract (`stream: true` +
`stream_options.include_usage`, `data: [DONE]` framing,
`reasoning_content` deltas collected separately, no `temperature`/`response_format`
— deepseek-reasoner rejects them). Two paths, identical wire contract:

1. **Harness path (preferred).** `@deepseek-ai/dsh-llm` — the DeepSeek
   Harness' provider-neutral LLM seam — is an optionalDependency, loaded
   through `loadDshLlm()` (variable-specifier dynamic import, never
   bundled, cached, null when absent). The provider subclasses the official
   abstract `LlmAdapter` and supplies the transport itself (the only
   official HTTP adapter, `@deepseek-ai/dsh-llm-deepseek`, stays
   uninstallable standalone — one of its rc peers, `dsh-environment`, is
   not published). The adapter emits the canonical `StreamChunk` protocol
   with the exact mappings of the official adapter (usage cache split,
   finish-reason vocabulary, HTTP → `LlmError` codes: `AUTH`, `RATE_LIMIT`,
   `SERVER`, `INVALID_REQUEST`, `QUOTA_EXCEEDED`,
   `CONTEXT_WINDOW_EXCEEDED`, `EMPTY_RESPONSE`, `STREAM_CLOSED`,
   `MALFORMED_RESPONSE`, `TRANSPORT`); the plan text assembles through the
   official `BlockAssembler`; the credential is judged by the official
   `assertUsableApiKey` (trimmed key is what the request sends; the secret
   never enters a message); every request carries the official
   `attributionHeaders()` identity (`tau/<version> (+repo url)`).
2. **Direct fallback.** When the optional package is absent
   (`--omit=optional`), `collectStreamText` consumes the same wire format
   with zero dependencies. Error text (`apiErrorMessage`) and request
   shape are identical across both paths, so tests and UX don't fork.

Config: `providers.deepseek.model | baseUrl | timeoutMs | apiKey`; key via
`providers.deepseek.apiKey` (preferred, `tau provider set-key`) or
`DEEPSEEK_API_KEY` env (fallback). Model discovery hits `GET {baseUrl}/models`.
Test seams: stub `globalThis.fetch` (never a real
endpoint); `setDshLlmLoaderForTests(loader)` forces either path without
touching node_modules; `resetDshLlmCache()` between tests.

## Safety boundary — the part you must not weaken

- `reviewPlan()` (src/core/safety.ts) runs AFTER the provider and BEFORE any
  confirmation/execution. It is deterministic and has no AI involvement.
- `DENY_PATTERNS` → verdict deny (exit code 2). `CAUTION_PATTERNS` → high
  risk (interactive confirm required; `--yes` refuses to auto-run high).
- `blocked` is final: no flag, no config, no provider output overrides it.
- If you add a pattern, add the matching test pair (positive + benign
  near-miss). Over-blocking is a bug too: a pattern that matches `curl` docs
  text makes the tool worse.
- Execution limits: timeout from config (default 30s), output cap 200k chars,
  plan ≤10 steps, shell command ≤2000 chars.

## Secret hygiene

- API keys resolve config-first (`providers.<name>.apiKey`, written by
  `tau provider set-key`, file chmod 0600) with env vars as fallback
  (`OPENAI_API_KEY`, `DEEPSEEK_API_KEY`). Keys are never logged, never
  echoed into prompts, and masked (`sk-***last4`) in every CLI surface that
  prints config (`config get/list`, `provider list`, `set-key` output).
- Provider errors may contain server messages: truncate to ~300 chars before
  displaying (chatJSON already does).
