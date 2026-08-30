/**
 * Model-catalog service — the model-selection data plane.
 * Live discovery per provider, 24h-cached catalogs persisted in config, and
 * request-time model resolution (resolveModel). No hardcoded defaults:
 * models come from user config or from what the provider actually serves.
 */

import { loadConfig, updateProviderEntry } from "@tau/core";
import { getProvider, providerNames } from "./registry.js";
import type { ModelInfo } from "@tau/core";

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

/** How the model for a request was determined. */
export type ResolvedModelSource = "config" | "catalog";

export interface ResolvedModel {
  model: string;
  source: ResolvedModelSource;
}

/**
 * Request-time model resolution — the counterpart to `tau provider use`.
 *
 * There are NO bundled default models. Precedence:
 * 1. explicit `providers.<name>.model` in the config (user-picked);
 * 2. the provider's live/cached catalog, when it offers exactly one model —
 *    auto-selected and persisted so `tau provider list` shows it and later
 *    runs stay stable;
 * 3. otherwise: a thrown error with an actionable fix (`tau provider use` or
 *    an explicit `tau config set providers.<name>.model`).
 */
export async function resolveModel(name: string): Promise<ResolvedModel> {
  const explicit = loadConfig().providers[name]?.["model"];
  if (typeof explicit === "string" && explicit.trim().length > 0) {
    return { model: explicit, source: "config" };
  }

  const provider = getProvider(name);
  if (!provider?.listModels) {
    throw new Error(
      `No model selected for "${name}" and the provider does not support model discovery — ` +
        `set one explicitly: tau config set providers.${name}.model <model-id>`,
    );
  }

  const catalog = await refreshProviderModels(name);
  const [only] = catalog.models;
  if (catalog.models.length === 1 && only) {
    updateProviderEntry(name, { model: only.id });
    return { model: only.id, source: "catalog" };
  }
  if (catalog.models.length === 0) {
    throw new Error(
      `No models discovered for "${name}" — pull/install a model or set one explicitly: ` +
        `tau config set providers.${name}.model <model-id>`,
    );
  }
  const sample = catalog.models
    .slice(0, 5)
    .map((model) => `"${model.id}"`)
    .join(", ");
  throw new Error(
    `No model selected for "${name}" — its catalog currently offers ` +
      `${catalog.models.length} models (e.g. ${sample}). ` +
      `Pick one with: tau provider use ${name}`,
  );
}
