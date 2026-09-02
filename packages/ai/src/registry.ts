/**
 * AI provider registry — idempotent provider registration plus lookup.
 * Registers the five built-ins (mock | ollama | openai | deepseek | zai) and
 * resolves the active provider from --provider / config.provider.
 */

import { loadConfig } from "@tau/core";
import type { AIProvider, ProviderChoice } from "@tau/core";
import { DeepSeekProvider } from "./providers/deepseek.js";
import { MockProvider } from "./providers/mock.js";
import { OllamaProvider } from "./providers/ollama.js";
import { OpenAIProvider } from "./providers/openai.js";
import { ZaiProvider } from "./providers/zai.js";

/**
 * Provider registry. To add a backend:
 * 1. Implement AIProvider (see src/types.ts)
 * 2. Register it below
 * 3. Document it in AGENTS/ai-integration.md
 */
const providers = new Map<string, AIProvider>();

export function registerProvider(provider: AIProvider): void {
  providers.set(provider.name, provider);
}

export function providerNames(): string[] {
  return [...providers.keys()].sort();
}

/** Look up one registered provider by name (undefined when unknown). */
export function getProvider(name: string): AIProvider | undefined {
  return providers.get(name);
}

export function resetProviders(): void {
  providers.clear();
}

export function resolveProvider(flag?: string): ProviderChoice {
  const config = loadConfig();
  const wanted = flag ?? process.env.TAU_PROVIDER ?? config.provider ?? "mock";
  let provider = providers.get(wanted);
  if (provider) {
    return {
      provider,
      source: flag ? "flag" : process.env.TAU_PROVIDER ? "env" : "config",
    };
  }
  // Unknown provider: fall back to mock so the CLI stays usable, but say so.
  provider = providers.get("mock")!;
  return { provider, source: "default" };
}

// Built-in registrations (idempotent helper kept public: resetProviders +
// registerProviderBuiltins is the test/reset idiom).
registerProviderBuiltins();

/** (Re-)register the five built-ins — the inverse of resetProviders. */
export function registerProviderBuiltins(): void {
  registerProvider(new MockProvider());
  registerProvider(new OllamaProvider());
  registerProvider(new OpenAIProvider());
  registerProvider(new DeepSeekProvider());
  registerProvider(new ZaiProvider());
}
