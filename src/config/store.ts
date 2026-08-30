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
    ollama: { host: "http://localhost:11434", model: "llama3.1" },
    openai: { model: "gpt-4o-mini" },
    deepseek: { model: "deepseek-chat" },
    zai: { model: "glm-4-flash" },
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
      providers: { ...DEFAULT_CONFIG.providers, ...parsed.providers },
    };
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function saveConfig(config: TauConfig): void {
  ensureHome();
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2) + "\n", "utf8");
}

/** `tau config get/set` — dotted top-level keys only, validated. */
export function getConfigValue(key: string): unknown {
  if (!VALID_KEYS.has(key)) {
    throw new Error(
      `Unknown config key "${key}". Valid keys: ${[...VALID_KEYS].sort().join(", ")}`,
    );
  }
  return loadConfig()[key as keyof TauConfig];
}

export function setConfigValue(key: string, value: string): unknown {
  if (!VALID_KEYS.has(key)) {
    throw new Error(
      `Unknown config key "${key}". Valid keys: ${[...VALID_KEYS].sort().join(", ")}`,
    );
  }
  const config = loadConfig();
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

  switch (key) {
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
