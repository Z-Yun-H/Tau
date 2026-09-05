/**
 * WebUI server tests — the provider-credential write path (issue #152):
 * POST /api/config/provider is the ONE writable config slice, sharing the
 * exact channel the CLI's `tau provider set-key` uses (setConfigValue →
 * saveConfig → chmod 0600). The gate/risk policy stays GET-only.
 *
 * Contract pinned here:
 * - GET /api/config carries the provider catalog (endpoints + console
 *   links), parity-checked against the live provider registry.
 * - A valid save returns the STANDARD REDACTED payload — the plaintext key
 *   is never echoed (the response shows sk-***last4) — and lands in the
 *   config file with owner-only permissions.
 * - Validation refuses BEFORE any mutation: unknown provider, unknown
 *   fields, empty key, malformed endpoint URL, wrong types → 400 and the
 *   config file stays untouched.
 * - activate switches the ACTIVE provider (the same "provider" key the
 *   CLI writes); keyless providers reject keys with the CLI's message.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configPath, loadConfig, tauHome } from "@tau/core";
import { providerNames } from "@tau/ai";
import { PROVIDER_CATALOG, baseUrlField } from "../src/provider-catalog.js";
import { startWebUi } from "../src/server.js";
import type { RunningWebUi } from "../src/server.js";

const ORIGINAL_CWD = process.cwd();
let tmp = "";
let ui: RunningWebUi;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-webui-provider-"));
  process.env["TAU_WEBUI_QUIET"] = "1";
  process.env.TAU_HOME = path.join(tmp, "home");
  fs.mkdirSync(tauHome(), { recursive: true });
  ui = await startWebUi({ port: 0 });
});

afterEach(async () => {
  await ui.close();
  process.chdir(ORIGINAL_CWD);
  delete process.env["TAU_WEBUI_QUIET"];
  delete process.env.TAU_HOME;
  fs.rmSync(tmp, { recursive: true, force: true });
});

const get = (pathName: string): Promise<{ status: number; json: any }> =>
  fetch(new URL(pathName, ui.url)).then(async (res) => ({
    status: res.status,
    json: await res.json(),
  }));

const post = (pathName: string, payload: unknown): Promise<{ status: number; json: any }> =>
  fetch(new URL(pathName, ui.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  }).then(async (res) => ({ status: res.status, json: await res.json() }));

const rawConfig = (): string => fs.readFileSync(configPath(), "utf8");

describe("GET /api/config — provider catalog", () => {
  it("ships the catalog with endpoints and console links, in registry parity", async () => {
    const res = await get("/api/config");
    expect(res.status).toBe(200);
    const catalog = res.json.providerCatalog as {
      name: string;
      defaultBaseUrl?: string;
      consoleUrl?: string;
    }[];
    // Every registered provider is present — adding a provider without a
    // catalog entry fails here (the catalog is the settings form's source).
    // Order-independent: the registry sorts; the catalog lists in setup
    // order (key-based providers first).
    expect(catalog.map((entry) => entry.name).sort()).toEqual([...providerNames()].sort());
    const deepseek = catalog.find((entry) => entry.name === "deepseek");
    expect(deepseek?.defaultBaseUrl).toBe("https://api.deepseek.com");
    expect(deepseek?.consoleUrl).toContain("platform.deepseek.com");
  });

  it("config keys arrive masked, never as plaintext", async () => {
    fs.writeFileSync(
      configPath(),
      JSON.stringify({ providers: { deepseek: { apiKey: "sk-test-abcdefgh1234" } } }),
      "utf8",
    );
    const res = await get("/api/config");
    const serialized = JSON.stringify(res.json);
    expect(serialized).not.toContain("sk-test-abcdefgh1234");
    expect(res.json.config.providers.deepseek.apiKey).toMatch(/^\*\*\*|sk-\*\*\*/);
  });
});

describe("POST /api/config/provider — the one writable config slice", () => {
  it("saves a key through the CLI's channel and returns the redacted payload", async () => {
    const res = await post("/api/config/provider", {
      provider: "deepseek",
      apiKey: "  sk-live-secret-9876  ",
    });
    expect(res.status).toBe(200);

    // The response is the standard payload — masked, never the plaintext.
    expect(JSON.stringify(res.json)).not.toContain("sk-live-secret-9876");
    expect(res.json.config.providers.deepseek.apiKey).toContain("***");

    // The file itself holds the plaintext (that is the config store's job),
    // owner-only, exactly as `tau provider set-key` would leave it.
    expect(rawConfig()).toContain("sk-live-secret-9876");
    const mode = fs.statSync(configPath()).mode & 0o777;
    expect(mode).toBe(0o600);

    // The trim mattered: the stored value is the trimmed key.
    expect(loadConfig().providers.deepseek?.apiKey).toBe("sk-live-secret-9876");
  });

  it("saves a custom endpoint under the right config field per provider", async () => {
    const openai = await post("/api/config/provider", {
      provider: "openai",
      baseUrl: "https://my-proxy.example.com/v1",
    });
    expect(openai.status).toBe(200);
    expect(loadConfig().providers.openai?.baseUrl).toBe("https://my-proxy.example.com/v1");

    const ollama = await post("/api/config/provider", {
      provider: "ollama",
      baseUrl: "http://192.168.1.10:11434",
    });
    expect(ollama.status).toBe(200);
    // Ollama's endpoint field is `host` (mirrors DEFAULT_CONFIG + the CLI).
    expect(loadConfig().providers.ollama?.host).toBe("http://192.168.1.10:11434");
    expect(baseUrlField("ollama")).toBe("host");
  });

  it("activate switches the ACTIVE provider in the same request", async () => {
    const res = await post("/api/config/provider", {
      provider: "anthropic",
      apiKey: "sk-ant-test-123456",
      activate: true,
    });
    expect(res.status).toBe(200);
    expect(res.json.config.provider).toBe("anthropic");
    expect(res.json.provider.name).toBe("anthropic");
    expect(loadConfig().provider).toBe("anthropic");
  });

  it("keyless providers refuse keys, but accept activation and endpoints", async () => {
    const refused = await post("/api/config/provider", {
      provider: "ollama",
      apiKey: "sk-not-needed",
    });
    // The catalog marks ollama keyless; the save endpoint refuses a key for
    // it (mirroring the CLI's KEYLESS refusal)…
    expect(refused.status).toBe(400);
    expect(refused.json.error).toContain("keyless");
    // …but endpoint + activation still work.
    const ok = await post("/api/config/provider", {
      provider: "ollama",
      baseUrl: "http://localhost:11434",
      activate: true,
    });
    expect(ok.status).toBe(200);
    expect(loadConfig().provider).toBe("ollama");
  });

  it.each([
    ["unknown provider", { provider: "does-not-exist", apiKey: "sk-x" }, /unknown provider/],
    ["missing provider", { apiKey: "sk-x" }, /provider \(string\) is required/],
    ["empty key", { provider: "deepseek", apiKey: "   " }, /apiKey must not be empty/],
    ["bad url", { provider: "deepseek", baseUrl: "not-a-url" }, /baseUrl must be an http\(s\) URL/],
    ["unknown field", { provider: "deepseek", timeout: 99 }, /unknown field "timeout"/],
    ["bad activate type", { provider: "deepseek", activate: "yes" }, /activate must be a boolean/],
  ])("refuses before mutating: %s", async (_label, payload, match) => {
    // Seed a known state so we can assert it was NOT touched.
    fs.writeFileSync(
      configPath(),
      JSON.stringify({ provider: "mock", providers: { deepseek: { apiKey: "sk-keep" } } }),
      "utf8",
    );
    const res = await post("/api/config/provider", payload);
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(match as RegExp);
    // Untouched: the refusal happened before any config write.
    expect(loadConfig().provider).toBe("mock");
    expect(loadConfig().providers.deepseek?.apiKey).toBe("sk-keep");
  });

  it("responds 400 (not 500) for malformed JSON bodies", async () => {
    const res = await fetch(new URL("/api/config/provider", ui.url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
  });
});

describe("catalog data integrity", () => {
  it("every non-keyless entry documents where to obtain a key", () => {
    for (const entry of PROVIDER_CATALOG) {
      if (entry.keyless) continue;
      expect(entry.consoleUrl, `${entry.name} needs a consoleUrl`).toMatch(/^https:\/\//);
      expect(entry.defaultBaseUrl, `${entry.name} needs a prefill`).toMatch(/^https?:\/\//);
    }
  });
});
