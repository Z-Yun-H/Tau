# AI providers

Tau talks to model providers through a narrow interface (`AIProvider`): `plan()` turns an intent into a strict-JSON plan; optional `listModels()` discovers models; optional `planStream()` / `reflect()` / `reflectStream()` add streaming planning and multi-round reflection. Seven providers ship built in:

| Provider          | Registry key | Streaming thinking                  | Reflect | Notes                                         |
| ----------------- | ------------ | ----------------------------------- | ------- | --------------------------------------------- |
| OpenAI-compatible | `openai`     | yes (SSE + `reasoning_content`)     | yes     | any chat/completions-compatible endpoint      |
| DeepSeek          | `deepseek`   | yes (incl. harness path)            | –       | official harness optional                     |
| Anthropic         | `anthropic`  | yes (Messages SSE `thinking_delta`) | yes     | optional extended thinking + thinkingBudget   |
| Google Gemini     | `gemini`     | yes (`alt=sse` thought parts)       | yes     | JSON mode via responseMimeType                |
| Ollama            | `ollama`     | yes (NDJSON)                        | –       | local models, `think: true` requests thinking |
| Z.ai              | `zai`        | yes (honest single-frame)           | –       | GLM series                                    |
| Mock              | `mock`       | yes (deterministic trace)           | yes     | offline demo/tests, always available          |

All providers are pure `fetch` — zero new runtime dependencies, unified config and key conventions.

## Configuration

```bash
tau config set provider anthropic
tau config set providers.anthropic.apiKey "sk-ant-..."
tau config set providers.anthropic.thinking true
tau config set providers.anthropic.thinkingBudget 4096

# Gemini also honors GOOGLE_API_KEY / GEMINI_API_KEY env vars
tau config set provider gemini
```

The configurable field whitelist: `apiKey`, `baseUrl`, `host`, `model`, `timeoutMs`, plus the v0.5.0 thinking toggles (`think` / `thinking` / `thinkingBudget`). `DEFAULT_CONFIG.providers` deliberately carries no model defaults — model choice is always your explicit decision.

## Selection precedence

`--provider` flag > `TAU_PROVIDER` env var > `config.provider`. Unknown names fall back to the mock provider with a note — the CLI stays usable but never silently pretends to be the provider you asked for.

## Streaming contract (v0.5.0)

`planStream` is optional: when missing, callers fall back to buffered `plan()` with zero behavior change. The streaming path is "always-stream" — without an observer, deltas are dropped, which IS the buffered semantics; one wire path serves both entrances. The returned plan passes the same strict validation and deterministic review as buffered mode.

Wiring a new provider? See [adding a provider](/en/reference/provider-dev).
