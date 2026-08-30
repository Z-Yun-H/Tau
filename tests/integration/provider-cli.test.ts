import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { main } from "../../src/index.js";
import { configPath, tauHome } from "../../src/config/paths.js";
import { loadConfig } from "../../src/config/store.js";

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_ARGV = process.argv;
const ORIGINAL_FETCH = globalThis.fetch;
let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-provider-cli-"));
  process.env.TAU_HOME = path.join(tmp, "home");
  fs.mkdirSync(tauHome(), { recursive: true });
  process.chdir(tmp);
  process.exitCode = 0;
  globalThis.fetch = ORIGINAL_FETCH;
  delete process.env.OPENAI_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  process.argv = ORIGINAL_ARGV;
  delete process.env.TAU_HOME;
  fs.rmSync(tmp, { recursive: true, force: true });
  globalThis.fetch = ORIGINAL_FETCH;
  process.exitCode = 0;
  vi.restoreAllMocks();
});

async function run(...args: string[]): Promise<string> {
  const lines: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    lines.push(parts.map((part) => String(part)).join(" "));
  });
  const err = vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    lines.push(parts.map((part) => String(part)).join(" "));
  });
  try {
    process.argv = ["node", "tau", ...args];
    await main(process.argv);
  } finally {
    log.mockRestore();
    err.mockRestore();
  }
  return lines.join("\n");
}

function stubModelsEndpoint(
  payload: unknown,
  status = 200,
): { calls: Array<{ url: string; auth: string }> } {
  const calls: Array<{ url: string; auth: string }> = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      auth: String(new Headers(init?.headers).get("authorization") ?? ""),
    });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { calls };
}

describe("tau provider CLI", () => {
  it("list shows registered providers with key source and model", async () => {
    const out = await run("provider", "list");
    for (const name of ["mock", "ollama", "openai", "deepseek", "zai"]) {
      expect(out).toContain(name);
    }
    expect(out).toContain("no key needed");
    expect(out).toContain("not cached yet");

    const json = JSON.parse(await run("provider", "list", "--json")) as Array<{
      provider: string;
      keySource: string;
      model: string;
      default: boolean;
    }>;
    expect(json).toHaveLength(5);
    const mock = json.find((row) => row.provider === "mock");
    expect(mock?.default).toBe(true);
    expect(mock?.keySource).toBe("-");
    const openai = json.find((row) => row.provider === "openai");
    expect(openai?.model).toBe("(auto)");
  });

  it("set-key stores the key and auto-refreshes the model catalog", async () => {
    const { calls } = stubModelsEndpoint({
      data: [
        { id: "gpt-4o-mini", owned_by: "openai" },
        { id: "gpt-4.1", owned_by: "openai" },
      ],
    });
    const out = await run("provider", "set-key", "openai", "sk-test-1234567890");

    // Key persisted, config file locked down.
    expect(loadConfig().providers["openai"]?.["apiKey"]).toBe("sk-test-1234567890");
    expect(fs.statSync(configPath()).mode & 0o777).toBe(0o600);

    // Auto-refresh happened and was cached.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/models");
    expect(calls[0]?.auth).toBe("Bearer sk-test-1234567890");
    expect(loadConfig().providers["openai"]?.["availableModels"]).toEqual([
      "gpt-4o-mini",
      "gpt-4.1",
    ]);
    expect(out).toContain("Model catalog refreshed: 2 model(s)");
    expect(out).toContain("gpt-4o-mini");
    expect(out).not.toContain("sk-test-1234567890"); // secret masked everywhere
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("set-key keeps the command green when the auto-refresh fails", async () => {
    stubModelsEndpoint({ error: { message: "bad key" } }, 401);
    const out = await run("provider", "set-key", "deepseek", "sk-ds-999000");
    expect(loadConfig().providers["deepseek"]?.["apiKey"]).toBe("sk-ds-999000");
    expect(out).toContain("Model catalog refresh failed");
    expect(out).toMatch(/DeepSeek API error 401/);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("set-key --no-refresh skips discovery; keyless providers are rejected", async () => {
    stubModelsEndpoint({ data: [{ id: "gpt-4o-mini" }] });
    const out = await run("provider", "set-key", "openai", "sk-x-123456789", "--no-refresh");
    expect(out).toContain("Catalog refresh skipped");
    expect(loadConfig().providers["openai"]?.["availableModels"]).toBeUndefined();

    const rejected = await run("provider", "set-key", "mock", "whatever");
    expect(rejected).toMatch(/no key needed/i);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it("models shows the catalog and marks the active model", async () => {
    stubModelsEndpoint({
      data: [{ id: "gpt-4o-mini", owned_by: "openai" }, { id: "gpt-4.1" }],
    });
    await run("provider", "set-key", "openai", "sk-test-1234567890");
    await run("config", "set", "provider", "openai");
    await run("config", "set", "providers.openai.model", "gpt-4.1");

    const out = await run("provider", "models");
    expect(out).toContain("gpt-4o-mini");
    expect(out).toContain("← current");

    const json = JSON.parse(await run("provider", "models", "--json")) as {
      provider: string;
      source: string;
      models: Array<{ id: string }>;
    };
    expect(json.provider).toBe("openai");
    expect(json.models).toHaveLength(2);
  });

  it("models --offline serves the cache without touching the network", async () => {
    stubModelsEndpoint({ data: [{ id: "gpt-4o-mini" }] });
    await run("provider", "set-key", "openai", "sk-test-1234567890");

    globalThis.fetch = (async () => {
      throw new Error("network must not be touched in --offline mode");
    }) as typeof fetch;
    const out = await run("provider", "models", "openai", "--offline");
    expect(out).toContain("gpt-4o-mini");
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("use selects provider + model and warns on unknown models", async () => {
    stubModelsEndpoint({ data: [{ id: "gpt-4o-mini" }, { id: "gpt-4.1" }] });
    await run("provider", "set-key", "openai", "sk-test-1234567890");

    const warnOut = await run("provider", "use", "openai", "gpt-custom-x");
    expect(loadConfig().provider).toBe("openai");
    expect(loadConfig().providers["openai"]?.["model"]).toBe("gpt-custom-x");
    expect(warnOut).toMatch(/not in the current openai catalog/);

    const okOut = await run("provider", "use", "openai", "gpt-4.1");
    expect(loadConfig().providers["openai"]?.["model"]).toBe("gpt-4.1");
    expect(okOut).toContain('Model set to "gpt-4.1"');
    expect(okOut).not.toMatch(/not in the current openai catalog/);
  });

  it("use without a model stays non-interactive off a TTY", async () => {
    stubModelsEndpoint({ data: [{ id: "mock-chat" }, { id: "mock-reasoner" }] });
    const out = await run("provider", "use", "mock");
    expect(loadConfig().provider).toBe("mock");
    expect(out).toMatch(/non-interactive session/i);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it("commands reject unknown providers", async () => {
    const out = await run("provider", "models", "ghost");
    expect(out).toMatch(/unknown provider/i);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  it("config list masks stored api keys; config get supports dotted keys", async () => {
    stubModelsEndpoint({ data: [] });
    await run("provider", "set-key", "openai", "sk-super-secret-4242");

    const listed = await run("config", "list");
    expect(listed).not.toContain("sk-super-secret-4242");
    expect(listed).toMatch(/sk-\*\*\*/);

    const got = await run("config", "get", "providers.openai.apiKey");
    expect(got).toMatch(/sk-\*\*\*/);
    expect(got).not.toContain("sk-super-secret-4242");

    const model = await run("config", "set", "providers.openai.model", "gpt-4.1");
    expect(model).toContain("providers.openai.model = gpt-4.1");
  });
});
