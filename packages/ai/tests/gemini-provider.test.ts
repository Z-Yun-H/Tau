/**
 * Gemini provider tests — request shaping + response parsing against a
 * stubbed fetch (never a real endpoint). Covers: Generative Language URL +
 * x-goog-api-key auth, responseMimeType JSON mode, alt=sse streaming with
 * thought parts, models discovery, key fallback order (config → GOOGLE →
 * GEMINI), and the optional thinkingBudget fragment.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setConfigValue } from "@tau/core";
import { planningContext } from "../src/prompt.js";
import { GeminiProvider } from "../src/providers/gemini.js";
import { resetProviders, registerProviderBuiltins, getProvider } from "../src/registry.js";

const ORIGINAL_FETCH = globalThis.fetch;
let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-gemini-"));
  process.env.TAU_HOME = path.join(tmp, "home");
  delete process.env.GOOGLE_API_KEY;
  delete process.env.GEMINI_API_KEY;
  globalThis.fetch = ORIGINAL_FETCH;
  resetProviders();
  registerProviderBuiltins();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TAU_HOME;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.GEMINI_API_KEY;
  fs.rmSync(tmp, { recursive: true, force: true });
  globalThis.fetch = ORIGINAL_FETCH;
});

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(frames.join("")));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

const PLAN_JSON = JSON.stringify({
  explanation: "list files",
  steps: [{ kind: "tool", tool: "file.find", args: { pattern: "*.ts" }, reason: "find" }],
  selfAssessedRisk: "low",
});

const STREAM_FRAMES = [
  `data: {"candidates":[{"content":{"parts":[{"text":"reasoning about the intent","thought":true}]}}]}\n\n`,
  `data: {"candidates":[{"content":{"parts":[{"text":${JSON.stringify(PLAN_JSON)}}]}}]}\n\n`,
  `data: {"candidates":[{"content":{},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":15,"candidatesTokenCount":6,"totalTokenCount":21}}\n\n`,
];

function configureModel(): void {
  setConfigValue("providers.gemini.model", "gemini-2.5-flash");
}

describe("GeminiProvider — availability & key order", () => {
  it("accepts GOOGLE_API_KEY, then GEMINI_API_KEY, config wins over both", async () => {
    const provider = new GeminiProvider();
    expect(await provider.isAvailable()).toBe(false);
    expect(provider.unavailableReason()).toContain("GOOGLE_API_KEY");
    process.env.GEMINI_API_KEY = "gemini-key";
    expect(provider.apiKey()).toBe("gemini-key");
    process.env.GOOGLE_API_KEY = "google-key";
    expect(provider.apiKey()).toBe("google-key");
    setConfigValue("providers.gemini.apiKey", "config-key");
    expect(provider.apiKey()).toBe("config-key");
  });
});

describe("GeminiProvider — plan/planStream wire", () => {
  it("streams via :streamGenerateContent?alt=sse with x-goog-api-key + JSON mode", async () => {
    configureModel();
    process.env.GOOGLE_API_KEY = "google-key";
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string | URL, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return sseResponse(STREAM_FRAMES);
    });
    const provider = new GeminiProvider();
    const plan = await provider.planStream(planningContext("find files", ""));
    expect(plan.steps[0]?.tool).toBe("file.find");

    const call = calls[0]!;
    expect(call.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
    );
    const headers = call.init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("google-key");
    const body = JSON.parse(String(call.init.body)) as {
      systemInstruction?: { parts?: { text?: string }[] };
      contents?: unknown[];
      generationConfig?: Record<string, unknown>;
    };
    expect(body.systemInstruction?.parts?.[0]?.text).toContain("terminal command planner");
    expect(JSON.stringify(body.contents)).toContain("find files");
    expect(body.generationConfig?.responseMimeType).toBe("application/json");
    expect(body.generationConfig?.temperature).toBe(0);
    expect(body.generationConfig?.thinkingConfig).toBeUndefined();
  });

  it("relays thought parts as reasoning events and usageMetadata as usage", async () => {
    configureModel();
    process.env.GOOGLE_API_KEY = "google-key";
    vi.stubGlobal("fetch", async () => sseResponse(STREAM_FRAMES));
    const provider = new GeminiProvider();
    const events: unknown[] = [];
    const plan = await provider.planStream(planningContext("find files", ""), (e) =>
      events.push(e),
    );
    expect(plan.explanation).toBe("list files");
    expect(events[0]).toEqual({
      type: "reasoning_delta",
      text: "reasoning about the intent",
    });
    const usage = events.at(-1) as { type: string; usage: { totalTokens: number } };
    expect(usage.type).toBe("usage");
    expect(usage.usage.totalTokens).toBe(21);
  });

  it("passes thinkingBudget through generationConfig when configured", async () => {
    configureModel();
    setConfigValue("providers.gemini.thinkingBudget", "2048");
    process.env.GOOGLE_API_KEY = "google-key";
    const calls: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: string | URL, init: RequestInit = {}) => {
      calls.push(init);
      return sseResponse(STREAM_FRAMES);
    });
    const provider = new GeminiProvider();
    await provider.plan(planningContext("x", ""));
    const body = JSON.parse(String(calls[0]!.body)) as {
      generationConfig?: { thinkingConfig?: { thinkingBudget: number } };
    };
    expect(body.generationConfig?.thinkingConfig).toEqual({ thinkingBudget: 2048 });
  });

  it("surfaces HTTP failures with the status in the message", async () => {
    configureModel();
    process.env.GOOGLE_API_KEY = "google-key";
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ error: { message: "quota exceeded" } }), { status: 429 }),
    );
    const provider = new GeminiProvider();
    await expect(provider.plan(planningContext("x", ""))).rejects.toThrow(/HTTP 429/);
  });
});

describe("GeminiProvider — model discovery", () => {
  it("parses the Generative Language models shape (models/ prefix stripped)", async () => {
    process.env.GOOGLE_API_KEY = "google-key";
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string | URL) => {
      calls.push(String(url));
      return new Response(
        JSON.stringify({
          models: [
            {
              name: "models/gemini-2.5-flash",
              displayName: "Gemini 2.5 Flash",
              supportedGenerationMethods: ["generateContent"],
            },
            { name: "models/gemini-2.5-pro", displayName: "Gemini 2.5 Pro" },
            { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const provider = new GeminiProvider();
    const models = await provider.listModels();
    expect(calls[0]).toBe("https://generativelanguage.googleapis.com/v1beta/models?pageSize=100");
    // Every listed model id keeps its id; discovery does not filter methods
    // (the catalog service and the user pick the planner-capable ones).
    expect(models.map((m) => m.id)).toEqual(["gemini-2.5-flash", "gemini-2.5-pro"]);
    expect(models[0]?.ownedBy).toBe("Gemini 2.5 Flash");
  });
});

describe("GeminiProvider — reflect wire", () => {
  it("returns a validated AgentDecision from the same wire", async () => {
    configureModel();
    process.env.GOOGLE_API_KEY = "google-key";
    const done = JSON.stringify({
      done: false,
      explanation: "next",
      steps: [{ kind: "shell", command: "echo next", reason: "r" }],
      note: "continue",
    });
    vi.stubGlobal("fetch", async () =>
      sseResponse([
        `data: {"candidates":[{"content":{"parts":[{"text":${JSON.stringify(done)}}]}}]}\n\n`,
      ]),
    );
    const provider = new GeminiProvider();
    const decision = await provider.reflect({
      intent: "x",
      toolCatalog: "",
      skillCatalog: "",
      platform: "linux",
      cwd: "/tmp",
      rounds: [{ round: 1, plan: { explanation: "e", steps: [] }, status: "ok", outputs: ["out"] }],
    });
    expect(decision).toMatchObject({ done: false, note: "continue" });
  });
});

describe("registry — gemini registered", () => {
  it("is discoverable by name", () => {
    expect(getProvider("gemini")).toBeInstanceOf(GeminiProvider);
  });
});
