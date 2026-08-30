/**
 * tau config store — defaults, deep-merged per-provider entries, dotted
 * get/set with field validation, 0600 persistence and secret masking.
 * Provider entries ship NO default model: models are user-selected or
 * resolved from the live catalog (see src/ai/models.ts).
 */

import fs from "node:fs";
import { configPath, ensureHome } from "./paths.js";
import type { TauConfig } from "../types.js";

export const DEFAULT_CONFIG: TauConfig = {
  provider: "mock",
  timeout: 30,
  allowMediumAutoApprove: false,
  aliases: {},
  plugins: [],
  providers: {
    // No bundled model defaults: models are either user-selected
    // (`tau provider use`) or resolved from the provider's live catalog at
    // request time (see resolveModel in src/ai/models.ts).
    ollama: { host: "http://localhost:11434" },
  },
};

const VALID_KEYS = new Set<string>([
  "provider",
  "timeout",
  "allowMediumAutoApprove",
  "aliases",
  "plugins",
  "providers",
]);

export function loadConfig(): TauConfig {
  const file = configPath();
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<TauConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      aliases: { ...DEFAULT_CONFIG.aliases, ...parsed.aliases },
      plugins: Array.isArray(parsed.plugins) ? parsed.plugins : [],
      providers: mergeProviders(DEFAULT_CONFIG.providers, parsed.providers),
    };
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

/**
 * Provider entries deep-merge per name so a partial user entry
 * (`{ "deepseek": { "apiKey": "..." } }`) keeps sibling fields — cached model
 * catalogs, timeoutMs, etc. — instead of wiping them.
 */
function mergeProviders(
  defaults: TauConfig["providers"],
  parsed: Partial<TauConfig["providers"]> | undefined,
): TauConfig["providers"] {
  const merged: TauConfig["providers"] = { ...defaults };
  for (const [name, entry] of Object.entries(parsed ?? {})) {
    merged[name] = { ...merged[name], ...entry };
  }
  return merged;
}

export function saveConfig(config: TauConfig): void {
  ensureHome();
  const file = configPath();
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n", "utf8");
  // The config may hold provider API keys (providers.<name>.apiKey); keep it
  // private to the owner. chmod 600 is a no-op on Windows read-only bits.
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* filesystems without chmod: best effort */
  }
}

/** `tau config get/set` — top-level keys plus dotted `providers.<name>.<field>`. */
export function getConfigValue(key: string): unknown {
  const segments = key.split(".");
  if (!VALID_KEYS.has(segments[0] ?? "")) {
    throw new Error(
      `Unknown config key "${key}". Valid keys: ${[...VALID_KEYS].sort().join(", ")}` +
        " and providers.<name>.<field>",
    );
  }
  let node: unknown = loadConfig();
  for (const segment of segments) {
    if (node === null || typeof node !== "object") {
      throw new Error(`Config key "${key}" does not exist.`);
    }
    const next = (node as Record<string, unknown>)[segment];
    if (next === undefined) {
      throw new Error(`Config key "${key}" is not set.`);
    }
    node = next;
  }
  return node;
}

/** Per-provider fields settable through `tau config set providers.<name>.<field>`. */
export const PROVIDER_FIELDS = ["apiKey", "baseUrl", "host", "model", "timeoutMs"] as const;

/** Merge a patch into one provider entry and persist (model cache, apiKey, ...). */
export function updateProviderEntry(provider: string, patch: Record<string, unknown>): TauConfig {
  if (!/^[a-z][a-z0-9-]*$/i.test(provider)) {
    throw new Error(`Invalid provider name "${provider}".`);
  }
  const config = loadConfig();
  const entry = config.providers[provider] ?? {};
  config.providers[provider] = { ...entry, ...patch };
  saveConfig(config);
  return config;
}

function coerceValue(key: string, field: string, value: string): unknown {
  // API keys are opaque strings — never coerce "1234" or "true" away.
  if (field === "apiKey") return value;
  let parsed: unknown = value;
  if (value === "true") parsed = true;
  else if (value === "false") parsed = false;
  else if (/^\d+$/.test(value)) parsed = Number(value);
  else if (value.startsWith("{") || value.startsWith("[")) {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error(`Value for "${key}" looks like JSON but failed to parse: ${value}`);
    }
  }
  return parsed;
}

export function setConfigValue(key: string, value: string): unknown {
  const segments = key.split(".");
  if (!VALID_KEYS.has(segments[0] ?? "")) {
    throw new Error(
      `Unknown config key "${key}". Valid keys: ${[...VALID_KEYS].sort().join(", ")}` +
        " and providers.<name>.<field>",
    );
  }

  // Dotted form: providers.<name>.<field>
  if (segments[0] === "providers") {
    if (segments.length === 1) {
      throw new Error(
        `Key "providers" is an object; edit ${configPath()} directly or set a nested key like providers.openai.model.`,
      );
    }
    if (segments.length === 2) {
      throw new Error(
        `Missing field: use providers.${segments[1]}.<field> with one of ${PROVIDER_FIELDS.join(", ")}.`,
      );
    }
    if (segments.length > 3) {
      throw new Error(`Config key "${key}" is too deep (providers.<name>.<field> expected).`);
    }
    const [, name, field] = segments as [string, string, string];
    if (!PROVIDER_FIELDS.includes(field as (typeof PROVIDER_FIELDS)[number])) {
      throw new Error(
        `Unknown provider field "${field}". Valid fields: ${PROVIDER_FIELDS.join(", ")}`,
      );
    }
    const parsed = coerceValue(key, field, value);
    if (field === "timeoutMs" && (!Number.isFinite(parsed) || (parsed as number) <= 0)) {
      throw new Error("timeoutMs must be a positive number (milliseconds)");
    }
    if (field === "apiKey" && String(parsed).trim().length === 0) {
      throw new Error("apiKey must not be empty");
    }
    updateProviderEntry(name, { [field]: parsed });
    return parsed;
  }

  // Simple top-level keys below.
  if (segments.length > 1) {
    throw new Error(
      `Unknown config key "${key}". Nested keys are only supported under providers.<name>.<field>.`,
    );
  }
  const config = loadConfig();
  const field = segments[0] ?? "";
  const parsed: unknown = coerceValue(key, field, value);

  switch (field) {
    case "provider":
      config.provider = String(parsed);
      break;
    case "timeout":
      config.timeout = Number(parsed);
      if (!Number.isFinite(config.timeout) || config.timeout <= 0) {
        throw new Error("timeout must be a positive number (seconds)");
      }
      break;
    case "allowMediumAutoApprove":
      config.allowMediumAutoApprove = Boolean(parsed);
      break;
    default:
      throw new Error(
        `Key "${key}" is an object; edit ${configPath()} directly or use tau alias/history commands.`,
      );
  }
  saveConfig(config);
  return parsed;
}

/* ------------------------------------------------------------------ *
 * Secret hygiene — the CLI never prints provider API keys in clear.
 * ------------------------------------------------------------------ */

/** Mask a secret for display: keeps a short prefix/suffix, hides the rest. */
export function maskSecret(value: unknown): string {
  const text = String(value ?? "");
  if (text.length === 0) return "(not set)";
  if (text.length <= 8) return "*".repeat(text.length);
  return `${text.slice(0, 3)}${"*".repeat(Math.max(text.length - 7, 3))}${text.slice(-4)}`;
}

/** Deep-copy a config with every `apiKey` field masked (safe to print). */
export function redactConfig(config: TauConfig): TauConfig {
  const clone = structuredClone(config);
  for (const entry of Object.values(clone.providers)) {
    if (entry && typeof entry === "object" && "apiKey" in entry) {
      entry["apiKey"] = maskSecret(entry["apiKey"]);
    }
  }
  return clone;
}
