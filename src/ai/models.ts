import { loadConfig, updateProviderEntry } from "../config/store.js";
import { getProvider, providerNames } from "./registry.js";
import type { ModelInfo } from "../types.js";

/**
 * Model-catalog service — the "model selection mode" behind `tau provider`.
 *
 * Flow: after an API key is configured (`tau provider set-key <p> <key>`),
 * the CLI immediately calls `refreshProviderModels()`; the discovered ids are
 * cached in the config (`providers.<name>.availableModels` +
 * `modelsRefreshedAt`) and drive model listing/selection from then on.
 * Cached catalogs older than MODELS_TTL_MS are refreshed opportunistically
 * whenever the catalog is displayed. Every failure path degrades to the
 * cache; a missing cache surfaces the error but never bricks the CLI.
 */

/** How long a cached catalog is served without a live re-fetch. */
export const MODELS_TTL_MS = 24 * 60 * 60 * 1000;

/** Where the served catalog came from. */
export type ModelCatalogSource = "live" | "cache" | "unsupported";

export interface ModelCatalog {
  provider: string;
  models: ModelInfo[];
  source: ModelCatalogSource;
  /** ISO timestamp of the last successful live fetch (when known). */
  refreshedAt?: string;
  /** Non-fatal problem: live fetch failed / discovery unsupported. */
  warning?: string;
}

/** Environment variable that can carry the provider key, when applicable. */
const ENV_KEYS: Record<string, string> = {
  deepseek: "DEEPSEEK_API_KEY",
  openai: "OPENAI_API_KEY",
};

export function providerEnvKey(name: string): string | undefined {
  return ENV_KEYS[name];
}

export type ApiKeySource = "config" | "env" | "none";

/** Where the provider's API key would come from right now. */
export function apiKeySource(name: string): ApiKeySource {
  const fromConfig = loadConfig().providers[name]?.["apiKey"];
  if (typeof fromConfig === "string" && fromConfig.trim().length > 0) return "config";
  const envName = ENV_KEYS[name];
  if (envName && typeof process.env[envName] === "string" && process.env[envName] !== "") {
    return "env";
  }
  return "none";
}

/** Cached catalog ids for a provider (empty when never refreshed). */
export function cachedModels(name: string): { models: ModelInfo[]; refreshedAt?: string } {
  const entry = loadConfig().providers[name] ?? {};
  const refreshedAt =
    typeof entry["modelsRefreshedAt"] === "string" ? entry["modelsRefreshedAt"] : undefined;
  const ids = Array.isArray(entry["availableModels"]) ? entry["availableModels"] : [];
  return {
    models: ids.filter((id): id is string => typeof id === "string").map((id) => ({ id })),
    ...(refreshedAt ? { refreshedAt } : {}),
  };
}

/** True when the cache is missing, unparsable, or older than ttl. */
export function isCatalogStale(name: string, ttlMs: number = MODELS_TTL_MS): boolean {
  const { refreshedAt } = cachedModels(name);
  if (!refreshedAt) return true;
  const time = Date.parse(refreshedAt);
  if (Number.isNaN(time)) return true;
  return Date.now() - time >= ttlMs;
}

function dedupeById(models: ModelInfo[]): ModelInfo[] {
  const seen = new Set<string>();
  const out: ModelInfo[] = [];
  for (const model of models) {
    if (model.id.length === 0 || seen.has(model.id)) continue;
    seen.add(model.id);
    out.push(model);
  }
  return out;
}

/**
 * Serve the model catalog for one provider:
 * - fresh cache and no `force` -> cache, zero network;
 * - otherwise live fetch -> persist ids + timestamp -> live;
 * - live failure with cache -> cached ids + warning;
 * - live failure without cache -> throw (caller decides how to degrade).
 */
export async function refreshProviderModels(
  name: string,
  opts: { force?: boolean; ttlMs?: number } = {},
): Promise<ModelCatalog> {
  const provider = getProvider(name);
  if (!provider) {
    throw new Error(
      `Unknown provider "${name}". Registered providers: ${providerNames().join(", ")}`,
    );
  }

  if (!provider.listModels) {
    return {
      provider: name,
      models: [],
      source: "unsupported",
      warning:
        `Provider "${name}" does not support model discovery — ` +
        `set the model with: tau config set providers.${name}.model <model>`,
    };
  }

  const ttl = opts.ttlMs ?? MODELS_TTL_MS;
  const cache = cachedModels(name);
  if (!opts.force && cache.models.length > 0 && !isCatalogStale(name, ttl)) {
    return {
      provider: name,
      models: cache.models,
      source: "cache",
      ...(cache.refreshedAt ? { refreshedAt: cache.refreshedAt } : {}),
    };
  }

  try {
    const models = dedupeById(await provider.listModels());
    const refreshedAt = new Date().toISOString();
    updateProviderEntry(name, {
      availableModels: models.map((model) => model.id),
      modelsRefreshedAt: refreshedAt,
    });
    return { provider: name, models, source: "live", refreshedAt };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (cache.models.length > 0) {
      return {
        provider: name,
        models: cache.models,
        source: "cache",
        ...(cache.refreshedAt ? { refreshedAt: cache.refreshedAt } : {}),
        warning: `Model refresh failed (${message}) — showing cached list from ${cache.refreshedAt ?? "unknown time"}.`,
      };
    }
    throw error instanceof Error ? error : new Error(message);
  }
}
