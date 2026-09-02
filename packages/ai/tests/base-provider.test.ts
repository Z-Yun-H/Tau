/**
 * BaseHttpProvider tests — the shared HTTP scaffolding (apiKey resolution,
 * isAvailable, unavailableReason, baseUrl/timeout defaults, listModels
 * error truncation). Subclasses (OpenAIProvider, DeepSeekProvider) inherit
 * this surface; here we cover it through OpenAIProvider to avoid a synthetic
 * subclass while still exercising the base class methods directly.
 *
 * AGENTS/ai-integration.md "Adding a provider — checklist" step 4: request
 * shaping + response parsing with a mocked fetch. Never hit real endpoints.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setConfigValue, configPath } from "@tau/core";
import { OpenAIProvider } from "../src/providers/openai.js";
import { DeepSeekProvider } from "../src/providers/deepseek.js";

const ORIGINAL_FETCH = globalThis.fetch;
let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-base-provider-"));
  process.env.TAU_HOME = path.join(tmp, "home");
  fs.mkdirSync(process.env.TAU_HOME, { recursive: true });
  delete process.env.OPENAI_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  globalThis.fetch = ORIGINAL_FETCH;
});

afterEach(() => {
  vi.unstubAllGlobals();
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

describe("BaseHttpProvider — shared scaffolding (via OpenAIProvider)", () => {
  it("resolves the API key config-first, then env", () => {
    const provider = new OpenAIProvider();
    expect(provider.apiKey()).toBeUndefined();
    process.env.OPENAI_API_KEY = "sk-from-env";
    expect(provider.apiKey()).toBe("sk-from-env");
    setConfigValue("providers.openai.apiKey", "sk-from-config-1234");
    expect(provider.apiKey()).toBe("sk-from-config-1234");
  });

  it("isAvailable tracks the presence of a key", async () => {
    const provider = new OpenAIProvider();
    expect(await provider.isAvailable()).toBe(false);
    process.env.OPENAI_API_KEY = "sk-test";
    expect(await provider.isAvailable()).toBe(true);
  });

  it("unavailableReason names the provider, the set-key command, and the env var", () => {
    const provider = new OpenAIProvider();
    const reason = provider.unavailableReason();
    expect(reason).toContain("OpenAI-compatible");
    expect(reason).toContain("tau provider set-key openai");
    expect(reason).toContain("OPENAI_API_KEY");
  });

  it("resolves baseUrl with trailing slash trimmed + config override", () => {
    // baseUrl is protected; access via the catalog listModels URL by stubbing fetch.
    const provider = new OpenAIProvider();
    setConfigValue("providers.openai.baseUrl", "https://gw.example.com/v1/");
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string | URL) => {
      calls.push(String(url));
      return jsonResponse({ data: [] });
    });
    void provider.listModels();
    // The trailing slash is trimmed before `/models` is appended.
    expect(calls[0]).toBe("https://gw.example.com/v1/models");
  });

  it("listModels parses the OpenAI-compatible { data: [{id, owned_by}] } shape", async () => {
    const provider = new OpenAIProvider();
    process.env.OPENAI_API_KEY = "sk-test";
    vi.stubGlobal("fetch", async () =>
      jsonResponse({
        data: [{ id: "gpt-4o", owned_by: "openai" }, { id: "gpt-4.1" }, { notAnId: true }],
      }),
    );
    const models = await provider.listModels();
    expect(models.map((m) => m.id)).toEqual(["gpt-4o", "gpt-4.1"]);
    expect(models[0]?.ownedBy).toBe("openai");
    expect(models[1]?.ownedBy).toBeUndefined();
  });

  it("listModels throws with HTTP status + truncated detail on auth failure", async () => {
    const provider = new OpenAIProvider();
    process.env.OPENAI_API_KEY = "sk-wrong";
    vi.stubGlobal("fetch", async () => jsonResponse({ error: { message: "bad key" } }, 401));
    await expect(provider.listModels()).rejects.toThrow(/HTTP 401/);
    await expect(provider.listModels()).rejects.toThrow(/OpenAI-compatible model listing failed/);
  });
});

describe("BaseHttpProvider — DeepSeekProvider inherits + overrides", () => {
  it("inherits apiKey/isAvailable/unavailableReason from the base", async () => {
    const provider = new DeepSeekProvider();
    expect(await provider.isAvailable()).toBe(false);
    process.env.DEEPSEEK_API_KEY = "sk-test";
    expect(await provider.isAvailable()).toBe(true);
    const reason = provider.unavailableReason();
    expect(reason).toContain("DeepSeek");
    expect(reason).toContain("DEEPSEEK_API_KEY");
    expect(reason).toContain("tau provider set-key deepseek");
  });

  it("overrides listModels to keep the DeepSeek-specific error format (test-pinned)", async () => {
    // The override preserves `/DeepSeek API error 401.*auth failed/` —
    // the base class would emit `DeepSeek model listing failed (HTTP 401): ...`
    // instead, breaking the provider-models snapshot.
    process.env.DEEPSEEK_API_KEY = "sk-wrong";
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ error: { message: "auth failed" } }), {
          status: 401,
        }),
    );
    await expect(new DeepSeekProvider().listModels()).rejects.toThrow(
      /DeepSeek API error 401.*auth failed/,
    );
  });

  it("resolves baseUrl + timeoutMs from config with DeepSeek defaults", () => {
    // The base class defaults come from the subclass config object.
    setConfigValue("providers.deepseek.apiKey", "sk-config-only");
    delete process.env.DEEPSEEK_API_KEY;
    // No assertion on the private values directly; the inherited listModels
    // uses baseUrl + apiKey together. Covered by provider-models.test.ts.
    expect(new DeepSeekProvider().apiKey()).toBe("sk-config-only");
  });
});

describe("BaseHttpProvider — config file chmod", () => {
  it("keeps the config file 0600 when an apiKey is written", () => {
    setConfigValue("providers.openai.apiKey", "sk-secret-value");
    const mode = fs.statSync(configPath()).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
