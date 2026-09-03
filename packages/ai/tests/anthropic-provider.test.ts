/**
 * Anthropic provider tests — request shaping + response parsing against a
 * stubbed fetch (never a real endpoint, AGENTS/ai-integration.md). Covers:
 * Messages API headers/body, streaming plan events, extended-thinking
 * request fragment, Models API discovery, and the reflect wire path.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setConfigValue } from "@tau/core";
import { planningContext } from "../src/prompt.js";
import { AnthropicProvider } from "../src/providers/anthropic.js";
import { resetProviders, registerProviderBuiltins, getProvider } from "../src/registry.js";

const ORIGINAL_FETCH = globalThis.fetch;
let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-anthropic-"));
  process.env.TAU_HOME = path.join(tmp, "home");
  delete process.env.ANTHROPIC_API_KEY;
  globalThis.fetch = ORIGINAL_FETCH;
  resetProviders();
  registerProviderBuiltins();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TAU_HOME;
  delete process.env.ANTHROPIC_API_KEY;
  fs.rmSync(tmp, { recursive: true, force: true });
  globalThis.fetch = ORIGINAL_FETCH;
});

/** Collect an SSE body into a Response (streaming content-type). */
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

const THINK_FRAMES = [
  'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":20,"output_tokens":1}}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"step 1: read the intent"}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"```json\\n"}}\n\n',
  `event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":${JSON.stringify(PLAN_JSON + "\\n")}}}\n\n`,
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"```"}}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":33}}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n',
];

function configureModel(): void {
  setConfigValue("providers.anthropic.model", "claude-sonnet-4-5");
}

describe("AnthropicProvider — availability", () => {
  it("tracks the key and names the set-key command + env var", async () => {
    const provider = new AnthropicProvider();
    expect(await provider.isAvailable()).toBe(false);
    expect(provider.unavailableReason()).toContain("tau provider set-key anthropic");
    expect(provider.unavailableReason()).toContain("ANTHROPIC_API_KEY");
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(await provider.isAvailable()).toBe(true);
  });
});

describe("AnthropicProvider — plan/planStream wire", () => {
  it("sends Messages API shaping: x-api-key, version, system, stream, max_tokens", async () => {
    configureModel();
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string | URL, init: RequestInit = {}) => {
      calls.push({ url: String(url), init });
      return sseResponse(THINK_FRAMES);
    });
    const provider = new AnthropicProvider();
    const plan = await provider.planStream(planningContext("find files", ""));
    expect(plan.steps[0]?.tool).toBe("file.find");

    const call = calls[0]!;
    expect(call.url).toBe("https://api.anthropic.com/v1/messages");
    const headers = call.init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(String(call.init.body)) as Record<string, unknown>;
    expect(body["model"]).toBe("claude-sonnet-4-5");
    expect(body["max_tokens"]).toBe(8192);
    expect(body["temperature"]).toBe(0);
    expect(body["stream"]).toBe(true);
    expect(body["system"]).toContain("terminal command planner");
    expect(JSON.stringify(body["messages"])).toContain("find files");
  });

  it("relays thinking deltas as reasoning events and usage, never into plan text", async () => {
    configureModel();
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    vi.stubGlobal("fetch", async () => sseResponse(THINK_FRAMES));
    const provider = new AnthropicProvider();
    const events: unknown[] = [];
    const plan = await provider.planStream(planningContext("find files", ""), (e) =>
      events.push(e),
    );
    expect(plan.explanation).toBe("list files");
    expect(events[0]).toEqual({ type: "reasoning_delta", text: "step 1: read the intent" });
    const usage = events.at(-1) as { type: string; usage: { promptTokens: number } };
    expect(usage.type).toBe("usage");
    expect(usage.usage.promptTokens).toBe(20);
    // The fenced wrapper text streamed through, validation unwrapped it.
    expect(events.some((e) => (e as { text?: string }).text === "```json\n")).toBe(true);
  });

  it("omits temperature when extended thinking is enabled (API contract)", async () => {
    configureModel();
    setConfigValue("providers.anthropic.thinking", "true");
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const calls: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: string | URL, init: RequestInit = {}) => {
      calls.push(init);
      return sseResponse(THINK_FRAMES);
    });
    const provider = new AnthropicProvider();
    await provider.plan(planningContext("x", ""));
    const body = JSON.parse(String(calls[0]!.body)) as Record<string, unknown>;
    expect(body["temperature"]).toBeUndefined();
    expect(body["thinking"]).toEqual({ type: "enabled", budget_tokens: 4096 });

    setConfigValue("providers.anthropic.thinkingBudget", "2048");
    await provider.plan(planningContext("x", ""));
    const body2 = JSON.parse(String(calls[1]!.body)) as Record<string, unknown>;
    expect(body2["thinking"]).toEqual({ type: "enabled", budget_tokens: 2048 });
  });

  it("surfaces HTTP failures with the status in the message", async () => {
    configureModel();
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 }),
    );
    const provider = new AnthropicProvider();
    await expect(provider.plan(planningContext("x", ""))).rejects.toThrow(/HTTP 401/);
  });
});

describe("AnthropicProvider — model discovery", () => {
  it("parses the Anthropic Models API shape", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string | URL) => {
      calls.push(String(url));
      return new Response(
        JSON.stringify({
          data: [
            { id: "claude-sonnet-4-5", type: "model", display_name: "Claude Sonnet 4.5" },
            { id: "claude-opus-4-1" },
            { noId: true },
          ],
          has_more: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const provider = new AnthropicProvider();
    const models = await provider.listModels();
    expect(calls[0]).toBe("https://api.anthropic.com/v1/models?limit=100");
    expect(models.map((m) => m.id)).toEqual(["claude-sonnet-4-5", "claude-opus-4-1"]);
    expect(models[0]?.ownedBy).toBe("Claude Sonnet 4.5");
  });
});

describe("AnthropicProvider — reflect wire", () => {
  it("returns a validated AgentDecision from the same wire", async () => {
    configureModel();
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const done = JSON.stringify({ done: true, answer: "all finished" });
    vi.stubGlobal("fetch", async () =>
      sseResponse([
        'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n',
        `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":${JSON.stringify(done)}}}\n\n`,
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ]),
    );
    const provider = new AnthropicProvider();
    const decision = await provider.reflect({
      intent: "x",
      toolCatalog: "",
      skillCatalog: "",
      platform: "linux",
      cwd: "/tmp",
      rounds: [{ round: 1, plan: { explanation: "e", steps: [] }, status: "ok", outputs: ["out"] }],
    });
    expect(decision).toEqual({ done: true, answer: "all finished" });
  });
});

describe("registry — anthropic registered", () => {
  it("is discoverable by name", () => {
    expect(getProvider("anthropic")).toBeInstanceOf(AnthropicProvider);
  });
});
