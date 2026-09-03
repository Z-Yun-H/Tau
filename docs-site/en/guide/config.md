# Configuration

Tau's config lives at `$TAU_HOME/config.json` (default `~/.tau/config.json`) and is read/written exclusively through `tau config`:

```bash
tau config list                        # effective config (API keys redacted)
tau config set provider deepseek       # set the default provider
tau config get provider                # read one key
```

## Top-level keys

| Key                      | Type     | Meaning                                                                       |
| ------------------------ | -------- | ----------------------------------------------------------------------------- |
| `provider`               | string   | default provider registry name (unknown names fall back to mock with a note)  |
| `timeout`                | number   | global timeout (seconds)                                                      |
| `allowMediumAutoApprove` | boolean  | whether medium steps may auto-approve (default false — writes always confirm) |
| `shell`                  | string   | shell used by shell steps                                                     |
| `aliases`                | object   | command aliases                                                               |
| `plugins`                | string[] | registered MCP plugins                                                        |

## Provider sub-config

Per-provider fields are **whitelisted**: `apiKey`, `baseUrl`, `host`, `model`, `timeoutMs`, plus the v0.5.0 thinking toggles `think` (ollama), `thinking` + `thinkingBudget` (anthropic), `thinkingBudget` (gemini).

```bash
tau config set providers.ollama.think true
tau config set providers.openai.baseUrl "https://your-proxy.example.com/v1"
tau config set providers.openai.model "gpt-4o-mini"
```

`DEFAULT_CONFIG.providers` deliberately carries no model defaults. API keys never appear in plaintext in logs or WebUI responses (uniformly redacted through `redactConfig`).

## Environment variables

- `TAU_HOME`: runtime data root (skills, config, history).
- `TAU_PROVIDER`: the env-var layer of provider selection (above config, below `--provider`).
- `GOOGLE_API_KEY` / `GEMINI_API_KEY`: Gemini key fallbacks.

## Principle

Config modification happens only in the CLI (`tau config set`). The WebUI settings panel is **read-only** — the browser is never a second write path into safety-relevant configuration.
