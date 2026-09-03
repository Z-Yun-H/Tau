/**
 * Streaming-plan (planStream) contract tests — mock determinism, the
 * OpenAI-compatible SSE path with reasoning_content, the ollama NDJSON
 * path, and zai's honest single-shot degradation. All fetch calls are
 * stubbed; no network, no real endpoints.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setConfigValue } from "@tau/core";
import { planningContext } from "../src/prompt.js";
import { MockProvider } from "../src/providers/mock.js";
import { OpenAIProvider } from "../src/providers/openai.js";
import { OllamaProvider } from "../src/providers/ollama.js";
import { ZaiProvider } from "../src/providers/zai.js";

const ORIGINAL_FETCH = globalThis.fetch;
let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-plan-stream-"));
  process.env.TAU_HOME = path.join(tmp, "home");
  delete process.env.OPENAI_API_KEY;
  globalThis.fetch = ORIGINAL_FETCH;
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TAU_HOME;
  delete process.env.OPENAI_API_KEY;
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
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("MockProvider.planStream — deterministic events", () => {
  it("emits reasoning → text deltas → usage and equals plan()", async () => {
    const provider = new MockProvider();
    const ctx = planningContext("find all ts files", "");
    const direct = await provider.plan(ctx);

    const events: unknown[] = [];
    const streamed = await provider.planStream(ctx, (e) => events.push(e));
    // Same result object the non-streaming path returns.
    expect(streamed).toEqual(direct);

    const kinds = events.map((e) => (e as { type: string }).type);
    expect(kinds[0]).toBe("reasoning_delta");
    expect(kinds).toContain("text_delta");
    expect(kinds.at(-1)).toBe("usage");
    // The text deltas assemble to the exact plan JSON document.
    const text = events
      .filter((e) => (e as { type: string }).type === "text_delta")
      .map((e) => (e as { text: string }).text)
      .join("");
    expect(JSON.parse(text)).toEqual(direct);

    // Same input → same event sequence (deterministic for screenshots).
    const events2: unknown[] = [];
    await provider.planStream(ctx, (e) => events2.push(e));
    expect(events2).toEqual(events);
  });

  it("produces a Chinese reasoning trace for Chinese intents", async () => {
    const provider = new MockProvider();
    const events: unknown[] = [];
    await provider.planStream(planningContext("查找所有 ts 文件", ""), (e) => events.push(e));
    const reasoning = events
      .filter((e) => (e as { type: string }).type === "reasoning_delta")
      .map((e) => (e as { text: string }).text)
      .join("");
    expect(reasoning).toContain("离线 mock 思考轨迹");
  });
});

describe("OpenAIProvider.planStream — SSE + reasoning_content", () => {
  it("streams with include_usage, relays deltas, validates the plan", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    setConfigValue("providers.openai.model", "gpt-test");
    const PLAN = JSON.stringify({
      explanation: "e",
      steps: [{ kind: "tool", tool: "file.find", args: {}, reason: "r" }],
    });
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string | URL, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return sseResponse([
        'data: {"choices":[{"delta":{"reasoning_content":"think"}}]}\n\n',
        `data: {"choices":[{"delta":{"content":${JSON.stringify(PLAN)}}}]}\n\n`,
        'data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":3,"total_tokens":10}}\n\n',
        "data: [DONE]\n\n",
      ]);
    });
    const provider = new OpenAIProvider();
    const events: unknown[] = [];
    const plan = await provider.planStream(planningContext("find", ""), (e) => events.push(e));
    expect(plan.explanation).toBe("e");

    const { url, init } = calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body["stream"]).toBe(true);
    expect(body["stream_options"]).toEqual({ include_usage: true });
    expect(body["response_format"]).toEqual({ type: "json_object" });
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");

    expect(events).toEqual([
      { type: "reasoning_delta", text: "think" },
      { type: "text_delta", text: PLAN },
      { type: "usage", usage: { promptTokens: 7, completionTokens: 3, totalTokens: 10 } },
    ]);
  });

  it("rejects HTTP errors before any stream is consumed", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    setConfigValue("providers.openai.model", "gpt-test");
    vi.stubGlobal("fetch", async () => new Response("nope", { status: 503 }));
    const provider = new OpenAIProvider();
    await expect(provider.planStream(planningContext("x", ""))).rejects.toThrow(/HTTP 503/);
  });
});

describe("OllamaProvider.planStream — NDJSON", () => {
  it("streams /api/chat with format json and relays deltas + counts", async () => {
    setConfigValue("providers.ollama.model", "llama-test");
    const PLAN = JSON.stringify({
      explanation: "e",
      steps: [{ kind: "shell", command: "echo hi", reason: "r" }],
    });
    const calls: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: string | URL, init: RequestInit = {}) => {
      calls.push(init);
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('{"message":{"content":"{"}}\n'));
          controller.enqueue(
            encoder.encode(`{"message":{"content":${JSON.stringify(PLAN.slice(1))}}}\n`),
          );
          controller.enqueue(
            encoder.encode('{"done":true,"prompt_eval_count":5,"eval_count":2}\n'),
          );
          controller.close();
        },
      });
      return new Response(body, { status: 200 });
    });
    const provider = new OllamaProvider();
    const events: unknown[] = [];
    const plan = await provider.planStream(planningContext("run echo", ""), (e) => events.push(e));
    expect(plan.steps[0]?.command).toBe("echo hi");
    const body = JSON.parse(String(calls[0]!.body)) as Record<string, unknown>;
    expect(body["stream"]).toBe(true);
    expect(body["format"]).toBe("json");
    const usage = events.at(-1) as { type: string; usage: { totalTokens: number } };
    expect(usage.type).toBe("usage");
    expect(usage.usage.totalTokens).toBe(7);
  });

  it("requests thinking only when providers.ollama.think is true", async () => {
    setConfigValue("providers.ollama.model", "llama-test");
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_url: string | URL, init: RequestInit = {}) => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('{"message":{"content":"{}"}}\n{"done":true}\n'));
          controller.close();
        },
      });
      return new Response(body, { status: 200 });
    });
    const provider = new OllamaProvider();
    // ollama plan() raises on invalid plans; use a minimal valid plan text.
    vi.stubGlobal("fetch", async (_url: string | URL, init: RequestInit = {}) => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `{"message":{"content":${JSON.stringify(
                JSON.stringify({
                  explanation: "e",
                  steps: [{ kind: "shell", command: "echo hi", reason: "r" }],
                }),
              )}}}\n{"done":true}\n`,
            ),
          );
          controller.close();
        },
      });
      return new Response(body, { status: 200 });
    });
    await provider.planStream(planningContext("x", ""));
    expect(bodies[0]!["think"]).toBeUndefined();
    setConfigValue("providers.ollama.think", "true");
    await provider.planStream(planningContext("x", ""));
    expect(bodies[1]!["think"]).toBe(true);
  });
});

describe("ZaiProvider.planStream — honest single-shot degradation", () => {
  it("emits exactly one text_delta and validates (no fake reasoning)", async () => {
    const provider = new ZaiProvider();
    setConfigValue("providers.zai.model", "glm-test");
    // No SDK installed in this repo → planStream throws the unavailable
    // reason (graceful degradation contract), exactly like plan().
    const events: unknown[] = [];
    await expect(
      provider.planStream(planningContext("x", ""), (e) => events.push(e)),
    ).rejects.toThrow(/z-ai-web-dev-sdk/);
    expect(events).toEqual([]);
  });
});
