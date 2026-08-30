import { loadConfig } from "../config/store.js";
import type { AIProvider, ProviderChoice } from "../types.js";
import { DeepSeekProvider } from "./providers/deepseek.js";
import { MockProvider } from "./providers/mock.js";
import { OllamaProvider } from "./providers/ollama.js";
import { OpenAIProvider } from "./providers/openai.js";
import { ZaiProvider } from "./providers/zai.js";

/**
 * Provider registry. To add a backend:
 * 1. Implement AIProvider (see src/types.ts)
 * 2. Register it below
 * 3. Document it in AGENTS.d/ai-integration.md
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

// Built-in registrations.
registerProvider(new MockProvider());
registerProvider(new OllamaProvider());
registerProvider(new OpenAIProvider());
registerProvider(new DeepSeekProvider());
registerProvider(new ZaiProvider());
