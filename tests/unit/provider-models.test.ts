import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getConfigValue,
  loadConfig,
  maskSecret,
  redactConfig,
  setConfigValue,
  updateProviderEntry,
} from "../../src/config/store.js";
import { configPath, tauHome } from "../../src/config/paths.js";
import {
  MODELS_TTL_MS,
  apiKeySource,
  cachedModels,
  isCatalogStale,
  refreshProviderModels,
  resolveModel,
} from "../../src/ai/models.js";
import { DeepSeekProvider } from "../../src/ai/providers/deepseek.js";
import { OllamaProvider } from "../../src/ai/providers/ollama.js";
import { OpenAIProvider } from "../../src/ai/providers/openai.js";

const ORIGINAL_CWD = process.cwd();
let tmp = "";
const ORIGINAL_FETCH = globalThis.fetch;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-models-"));
  process.env.TAU_HOME = path.join(tmp, "home");
  fs.mkdirSync(tauHome(), { recursive: true });
  globalThis.fetch = ORIGINAL_FETCH;
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  delete process.env.TAU_HOME;
  delete process.env.OPENAI_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  fs.rmSync(tmp, { recursive: true, force: true });
  globalThis.fetch = ORIGINAL_FETCH;
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/* ---------------- dotted config keys ---------------- */

describe("config store: dotted provider keys", () => {
  it("stores an apiKey without bundling a default model", () => {
    setConfigValue("providers.deepseek.apiKey", "sk-test-1234567890abcd");
    const config = loadConfig();
    expect(config.providers["deepseek"]?.["apiKey"]).toBe("sk-test-1234567890abcd");
    expect(config.providers["deepseek"]?.["model"]).toBeUndefined();
  });

  it("reads dotted keys (set works; unset defaults do not exist)", () => {
    expect(() => getConfigValue("providers.deepseek.model")).toThrow(/does not exist|is not set/);
    setConfigValue("providers.openai.model", "gpt-4.1");
    expect(getConfigValue("providers.openai.model")).toBe("gpt-4.1");
  });

  it("keeps api keys as opaque strings (no coercion)", () => {
    setConfigValue("providers.openai.apiKey", "12345678");
    expect(getConfigValue("providers.openai.apiKey")).toBe("12345678");
    setConfigValue("providers.openai.apiKey", "true");
    expect(getConfigValue("providers.openai.apiKey")).toBe("true");
  });

  it("rejects unknown fields, shallow provider keys and unknown nested keys", () => {
    expect(() => setConfigValue("providers.deepseek.wat", "x")).toThrow(/unknown provider field/i);
    expect(() => setConfigValue("providers.deepseek", "x")).toThrow(/missing field/i);
    expect(() => setConfigValue("providers", "{}")).toThrow(/object/i);
    expect(() => setConfigValue("aliases.foo", "x")).toThrow(
      /nested keys are only supported under providers/i,
    );
    expect(() => setConfigValue("providers.deepseek.apiKey", "  ")).toThrow(/empty/i);
  });

  it("reports unset nested keys clearly", () => {
    expect(() => getConfigValue("providers.ghost.model")).toThrow(/is not set/);
  });

  it("chmods the config file to 0600 once written", () => {
    setConfigValue("providers.deepseek.apiKey", "sk-secret-value");
    const mode = fs.statSync(configPath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("masks secrets for display without touching the stored value", () => {
    setConfigValue("providers.openai.apiKey", "sk-very-secret-openai-key-99");
    expect(maskSecret("sk-very-secret-openai-key-99")).toMatch(/^sk-\*+\w-99$/);
    const printed = JSON.stringify(redactConfig(loadConfig()));
    expect(printed).not.toContain("sk-very-secret-openai-key-99");
    expect(loadConfig().providers["openai"]?.["apiKey"]).toBe("sk-very-secret-openai-key-99");
  });
});

/* ---------------- resolveModel (request-time selection) ---------------- */

describe("resolveModel", () => {
  it("prefers the explicit config model without touching the network", async () => {
    setConfigValue("providers.openai.model", "gpt-4.1");
    globalThis.fetch = (async () => {
      throw new Error("no network expected when a model is configured");
    }) as typeof fetch;
    expect(await resolveModel("openai")).toEqual({ model: "gpt-4.1", source: "config" });
  });

  it("auto-selects and persists when the catalog offers exactly one model", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ data: [{ id: "gpt-5-mini", owned_by: "openai" }] })) as typeof fetch;
    const resolved = await resolveModel("openai");
    expect(resolved).toEqual({ model: "gpt-5-mini", source: "catalog" });
    expect(loadConfig().providers["openai"]?.["model"]).toBe("gpt-5-mini");
  });

  it("rejects with actionable guidance when the catalog has several models", async () => {
    globalThis.fetch = (async () =>
      jsonResponse({
        data: [{ id: "m-one" }, { id: "m-two" }, { id: "m-three" }],
      })) as typeof fetch;
    await expect(resolveModel("openai")).rejects.toThrow(/tau provider use openai/);
    await expect(resolveModel("openai")).rejects.toThrow(/3 models/);
  });

  it("rejects when discovery finds nothing", async () => {
    globalThis.fetch = (async () => jsonResponse({ data: [] })) as typeof fetch;
    await expect(resolveModel("openai")).rejects.toThrow(/No models discovered/);
  });

  it("tells the user to set a model explicitly when discovery is unsupported", async () => {
    await expect(resolveModel("zai")).rejects.toThrow(/does not support model discovery/);
    await expect(resolveModel("zai")).rejects.toThrow(/providers\.zai\.model/);
  });
});

/* ---------------- model catalog service ---------------- */

describe("model catalog service", () => {
  it("serves a live catalog and persists the cache", async () => {
    const catalog = await refreshProviderModels("mock", { force: true });
    expect(catalog.source).toBe("live");
    expect(catalog.models.map((model) => model.id)).toEqual(["mock-chat", "mock-reasoner"]);
    const cache = cachedModels("mock");
    expect(cache.models.map((model) => model.id)).toEqual(["mock-chat", "mock-reasoner"]);
    expect(cache.refreshedAt).toBeTruthy();
    expect(isCatalogStale("mock")).toBe(false);
  });

  it("supports forced refresh and TTL staleness", async () => {
    await refreshProviderModels("mock", { force: true });
    expect(await refreshProviderModels("mock").then((c) => c.source)).toBe("cache");
    expect(isCatalogStale("mock", 0)).toBe(true);
    expect(isCatalogStale("mock", MODELS_TTL_MS)).toBe(false);
  });

  it("reports providers without discovery as unsupported", async () => {
    const catalog = await refreshProviderModels("zai");
    expect(catalog.source).toBe("unsupported");
    expect(catalog.warning).toMatch(/does not support model discovery/i);
  });

  it("throws for unknown providers", async () => {
    await expect(refreshProviderModels("ghost")).rejects.toThrow(/unknown provider/i);
  });
});

/* ---------------- provider listModels ---------------- */

describe("provider listModels", () => {
  it("openai: parses /models, prefers the config key over env", async () => {
    setConfigValue("providers.openai.apiKey", "sk-from-config-000");
    process.env.OPENAI_API_KEY = "sk-from-env";
    const calls: Array<{ url: string; key: string }> = [];
    globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
      calls.push({
        url: String(url),
        key: String(new Headers(init?.headers).get("authorization")),
      });
      return jsonResponse({
        data: [{ id: "gpt-4o-mini", owned_by: "openai" }, { id: "gpt-4.1" }, { notAnId: true }],
      });
    }) as typeof fetch;

    const provider = new OpenAIProvider();
    expect(apiKeySource("openai")).toBe("config");
    const models = await provider.listModels();
    expect(models.map((m) => m.id)).toEqual(["gpt-4o-mini", "gpt-4.1"]);
    expect(models[0]?.ownedBy).toBe("openai");
    expect(models[1]?.ownedBy).toBeUndefined();
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/models");
    expect(calls[0]?.key).toBe("Bearer sk-from-config-000");

    // env fallback when no config key exists
    fs.rmSync(configPath(), { force: true });
    process.env.OPENAI_API_KEY = "sk-from-env";
    expect(apiKeySource("openai")).toBe("env");
    await expect(new OpenAIProvider().listModels()).resolves.toHaveLength(2);
    expect(calls[calls.length - 1]?.key).toBe("Bearer sk-from-env");
  });

  it("openai: throws with HTTP status on auth failure", async () => {
    process.env.OPENAI_API_KEY = "sk-wrong";
    globalThis.fetch = (async () =>
      jsonResponse({ error: { message: "bad key" } }, 401)) as typeof fetch;
    await expect(new OpenAIProvider().listModels()).rejects.toThrow(/HTTP 401/);
  });

  it("deepseek: hits {baseUrl}/models with the config key", async () => {
    setConfigValue("providers.deepseek.apiKey", "sk-ds-config-key");
    setConfigValue("providers.deepseek.baseUrl", "https://api.example.com");
    const calls: string[] = [];
    globalThis.fetch = (async (url: string | URL) => {
      calls.push(String(url));
      return jsonResponse({ data: [{ id: "deepseek-chat" }, { id: "deepseek-reasoner" }] });
    }) as typeof fetch;

    const models = await new DeepSeekProvider().listModels();
    expect(models.map((m) => m.id)).toEqual(["deepseek-chat", "deepseek-reasoner"]);
    expect(calls[0]).toBe("https://api.example.com/models");
    expect(isCatalogStale("deepseek")).toBe(true); // listModels alone does not cache
  });

  it("deepseek: maps non-2xx through the shared error formatter", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-wrong";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: "auth failed" } }), {
        status: 401,
      })) as typeof fetch;
    await expect(new DeepSeekProvider().listModels()).rejects.toThrow(
      /DeepSeek API error 401.*auth failed/,
    );
  });

  it("deepseek: isAvailable is true with only a config key", async () => {
    setConfigValue("providers.deepseek.apiKey", "sk-config-only");
    delete process.env.DEEPSEEK_API_KEY;
    await expect(new DeepSeekProvider().isAvailable()).resolves.toBe(true);
  });

  it("ollama: parses /api/tags names", async () => {
    setConfigValue("providers.ollama.host", "http://127.0.0.1:9");
    globalThis.fetch = (async () =>
      jsonResponse({ models: [{ name: "llama3.1:latest" }, { name: "qwen2.5" }] })) as typeof fetch;
    const models = await new OllamaProvider().listModels();
    expect(models.map((m) => m.id)).toEqual(["llama3.1:latest", "qwen2.5"]);
  });
});

/* ---------------- degradation ---------------- */

describe("model catalog degradation", () => {
  it("falls back to the cache when the live refresh fails", async () => {
    await refreshProviderModels("mock", { force: true });
    // Break discovery to simulate a network/API failure.
    const provider = (await import("../../src/ai/registry.js")).getProvider("mock");
    const original = provider?.listModels;
    if (provider)
      provider.listModels = async () => {
        throw new Error("boom");
      };
    try {
      const catalog = await refreshProviderModels("mock", { force: true });
      expect(catalog.source).toBe("cache");
      expect(catalog.warning).toMatch(/boom/);
      expect(catalog.models).toHaveLength(2);
    } finally {
      if (provider && original) provider.listModels = original;
    }
  });

  it("propagates failures when there is no cache to fall back to", async () => {
    updateProviderEntry("deepseek", { apiKey: "sk-x" });
    globalThis.fetch = (async () =>
      jsonResponse({ error: { message: "down" } }, 500)) as typeof fetch;
    await expect(refreshProviderModels("deepseek", { force: true })).rejects.toThrow(/500/);
  });
});
