/**
 * Provider catalog for the WebUI settings (issue #152) — the lookup that
 * spares users from typing model API endpoints by hand: pick a provider,
 * the endpoint prefills, only the API key is pasted.
 *
 * SINGLE SOURCE RULES (keep drift honest):
 * - `name` / `label` MUST mirror the registered providers (packages/ai/src/
 *   providers/*); server.test.ts parity-checks the catalog against the live
 *   registry (`providerNames()`), so adding a provider without updating this
 *   file fails the gate.
 * - `defaultBaseUrl` is transcribed from each provider's DEFAULT_BASE_URL —
 *   it is a DISPLAY PREFILL for the settings form (and the `host` field for
 *   ollama), not a second resolution path; the providers themselves keep
 *   reading `providers.<name>.baseUrl` from the config store.
 * - `consoleUrl` is where the user obtains a key. App-layer data by design:
 *   the CLI keeps its own KEYLESS map (app/cli/src/provider.ts) — the WebUI
 *   never imports from @tau/cli.
 */

export interface ProviderCatalogEntry {
  /** Registry key (config: `providers.<name>.*`). */
  name: string;
  /** Human-readable label — mirrors the provider's own `label`. */
  label: string;
  /** Default API endpoint prefilled into the setup form (advanced-editable). */
  defaultBaseUrl?: string;
  /** Where the user obtains an API key (console key page). */
  consoleUrl?: string;
  /** True when the provider needs no API key (local / offline / SDK auth). */
  keyless?: boolean;
  /** One-line hint shown for keyless / special providers. */
  note?: string;
}

export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  {
    name: "openai",
    label: "OpenAI-compatible",
    defaultBaseUrl: "https://api.openai.com/v1",
    consoleUrl: "https://platform.openai.com/api-keys",
  },
  {
    name: "anthropic",
    label: "Anthropic (Claude)",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    consoleUrl: "https://console.anthropic.com/settings/keys",
  },
  {
    name: "deepseek",
    label: "DeepSeek",
    defaultBaseUrl: "https://api.deepseek.com",
    consoleUrl: "https://platform.deepseek.com/api_keys",
  },
  {
    name: "gemini",
    label: "Google (Gemini)",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    consoleUrl: "https://aistudio.google.com/apikey",
  },
  {
    name: "zai",
    label: "Z.ai (GLM)",
    keyless: true,
    note: "authenticates through z-ai-web-dev-sdk — no API key is used",
  },
  {
    name: "ollama",
    label: "Ollama (local)",
    defaultBaseUrl: "http://localhost:11434",
    keyless: true,
    note: "runs locally — the endpoint above is saved as providers.ollama.host",
  },
  {
    name: "mock",
    label: "Mock (offline demo)",
    keyless: true,
    note: "offline demo provider — plans without any AI backend",
  },
];

/** Catalog entry for a provider name (undefined when unregistered). */
export function catalogEntry(name: string): ProviderCatalogEntry | undefined {
  return PROVIDER_CATALOG.find((entry) => entry.name === name);
}

/**
 * The config field a custom endpoint is stored under: OpenAI-shaped
 * providers use `providers.<name>.baseUrl`, Ollama uses `host`.
 */
export function baseUrlField(name: string): "baseUrl" | "host" {
  return name === "ollama" ? "host" : "baseUrl";
}
