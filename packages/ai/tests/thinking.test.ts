/**
 * Thinking-layer tests (issue #162) — the normalized thinking-mode /
 * thinking-effort configuration surface: capability matrix, normalized
 * read (legacy booleans fold in), validated write (capability refusals),
 * effort presets, and the wire fragments providers derive from it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, setConfigValue } from "@tau/core";
import { configPath, tauHome } from "@tau/core";
import {
  EFFORT_BUDGETS,
  describeThinking,
  getThinkingConfig,
  hasThinkingConfig,
  setThinkingConfig,
  thinkingCapability,
} from "../src/thinking.js";
import { planningContext } from "../src/prompt.js";
import { AnthropicProvider } from "../src/providers/anthropic.js";
import { DeepSeekProvider } from "../src/providers/deepseek.js";
import { GeminiProvider } from "../src/providers/gemini.js";
import { OllamaProvider } from "../src/providers/ollama.js";
import { OpenAIProvider } from "../src/providers/openai.js";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_CWD = process.cwd();
let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-thinking-"));
  process.env.TAU_HOME = path.join(tmp, "home");
  fs.mkdirSync(tauHome(), { recursive: true });
  globalThis.fetch = ORIGINAL_FETCH;
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.chdir(ORIGINAL_CWD);
  delete process.env.TAU_HOME;
  delete process.env.OPENAI_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  fs.rmSync(tmp, { recursive: true, force: true });
  globalThis.fetch = ORIGINAL_FETCH;
});

/* ---------------- capability matrix ---------------- */

describe("thinkingCapability", () => {
  it("declares the per-provider knob table", () => {
    expect(thinkingCapability("anthropic")).toEqual({ mode: true, effort: true, budget: true });
    expect(thinkingCapability("gemini")).toEqual({ mode: true, effort: true, budget: true });
    expect(thinkingCapability("openai")).toEqual({ mode: false, effort: true, budget: false });
    expect(thinkingCapability("deepseek")).toEqual({ mode: true, effort: false, budget: false });
    expect(thinkingCapability("ollama")).toEqual({ mode: true, effort: false, budget: false });
  });

  it("reports no knobs for knob-less and unknown providers", () => {
    expect(thinkingCapability("mock")).toEqual({ mode: false, effort: false, budget: false });
    expect(thinkingCapability("zai")).toEqual({ mode: false, effort: false, budget: false });
    expect(thinkingCapability("nonexistent")).toEqual({
      mode: false,
      effort: false,
      budget: false,
    });
  });
});

/* ---------------- normalized read ---------------- */

describe("getThinkingConfig", () => {
  it("returns an empty config when nothing is set", () => {
    expect(getThinkingConfig("deepseek")).toEqual({});
    expect(hasThinkingConfig("deepseek")).toBe(false);
  });

  it("reads the normalized string keys", () => {
    setConfigValue("providers.openai.thinkingEffort", "high");
    expect(getThinkingConfig("openai")).toEqual({ effort: "high" });
    expect(hasThinkingConfig("openai")).toBe(true);
  });

  it("folds legacy booleans into the mode", () => {
    setConfigValue("providers.anthropic.thinking", "true"); // coerceValue → boolean
    expect(getThinkingConfig("anthropic").mode).toBe("on");
    setConfigValue("providers.anthropic.thinking", "false");
    expect(getThinkingConfig("anthropic").mode).toBe("off");
  });

  it("folds ollama's legacy think key into the mode", () => {
    setConfigValue("providers.ollama.think", "true");
    expect(getThinkingConfig("ollama").mode).toBe("on");
  });

  it("ignores invalid effort values instead of passing them through", () => {
    setConfigValue("providers.openai.thinkingEffort", "extreme");
    expect(getThinkingConfig("openai")).toEqual({});
  });

  it("keeps a positive explicit budget", () => {
    setConfigValue("providers.anthropic.thinkingBudget", "4096");
    expect(getThinkingConfig("anthropic")).toEqual({ budget: 4096 });
  });
});

/* ---------------- validated write ---------------- */

describe("setThinkingConfig", () => {
  it("writes the normalized keys and persists them", () => {
    const next = setThinkingConfig("deepseek", { mode: "on" });
    expect(next).toEqual({ mode: "on" });
    expect(loadConfig().providers["deepseek"]?.["thinking"]).toBe("on");
  });

  it("round-trips through the config file", () => {
    setThinkingConfig("anthropic", { mode: "on", effort: "high" });
    const reread = getThinkingConfig("anthropic");
    expect(reread.mode).toBe("on");
    expect(reread.effort).toBe("high");
    expect(configPath()).toBeTruthy();
  });

  it("refuses mode on providers without the knob", () => {
    expect(() => setThinkingConfig("openai", { mode: "on" })).toThrow(
      /does not support a thinking mode toggle/,
    );
    expect(() => setThinkingConfig("mock", { mode: "on" })).toThrow(/mode/);
  });

  it("refuses effort on providers without the knob", () => {
    expect(() => setThinkingConfig("deepseek", { effort: "high" })).toThrow(
      /does not support a thinking effort level/,
    );
  });

  it("refuses a budget on providers without the knob", () => {
    expect(() => setThinkingConfig("openai", { budget: 4096 })).toThrow(
      /does not support an explicit thinking budget/,
    );
  });

  it("refuses invalid effort values", () => {
    expect(() => setThinkingConfig("anthropic", { effort: "extreme" as "low" })).toThrow(
      /low\|medium\|high/,
    );
  });

  it("refuses non-positive budgets", () => {
    expect(() => setThinkingConfig("anthropic", { budget: 0 })).toThrow(/positive/);
    expect(() => setThinkingConfig("anthropic", { budget: -5 })).toThrow(/positive/);
  });

  it("clears keys with null, shrinking the entry", () => {
    setThinkingConfig("anthropic", { mode: "on", effort: "low" });
    setThinkingConfig("anthropic", { effort: null });
    expect(getThinkingConfig("anthropic")).toEqual({ mode: "on" });
    setThinkingConfig("anthropic", { mode: null });
    expect(getThinkingConfig("anthropic")).toEqual({});
    const entry = loadConfig().providers["anthropic"] ?? {};
    expect("thinking" in entry).toBe(false);
    expect("thinkingEffort" in entry).toBe(false);
  });

  it("allows clearing even unsupported knobs (removal is always safe)", () => {
    expect(() => setThinkingConfig("mock", { mode: null })).not.toThrow();
  });
});

/* ---------------- presets & summary ---------------- */

describe("effort presets and describeThinking", () => {
  it("maps effort levels to ascending budgets", () => {
    expect(EFFORT_BUDGETS["low"]).toBeLessThan(EFFORT_BUDGETS["medium"]);
    expect(EFFORT_BUDGETS["medium"]).toBeLessThan(EFFORT_BUDGETS["high"]);
  });

  it("summarizes the state the UIs print", () => {
    expect(describeThinking("deepseek")).toBe("provider default");
    setThinkingConfig("deepseek", { mode: "on" });
    expect(describeThinking("deepseek")).toBe("on");
    setThinkingConfig("anthropic", { mode: "on", effort: "high" });
    expect(describeThinking("anthropic")).toBe("on (high)");
    setThinkingConfig("openai", { effort: "low" });
    expect(describeThinking("openai")).toBe("effort low");
    setThinkingConfig("anthropic", { mode: "off" });
    expect(describeThinking("anthropic")).toBe("off");
  });
});

/* ---------------- provider wire fragments ---------------- *
 * The normalized config must reach each provider's request body EXACTLY
 * when a knob is configured — the default request stays byte-identical.
 */

const PLAN = JSON.stringify({
  explanation: "list files",
  steps: [{ kind: "tool", tool: "file.find", args: { pattern: "*.ts" }, reason: "find" }],
  selfAssessedRisk: "low",
});

const CTX = planningContext("find files", "");

function jsonPlanResponse(): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: PLAN } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function anthropicSse(): Response {
  const frames = [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
    `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":${JSON.stringify(PLAN)}}}\n\n`,
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ];
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(frames.join("")));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function geminiSse(): Response {
  const encoder = new TextEncoder();
  const frames = [
    `data: ${JSON.stringify({
      candidates: [{ content: { parts: [{ text: PLAN }], role: "model" }, finishReason: "STOP" }],
    })}\n\n`,
  ];
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(frames.join("")));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function ollamaResponse(): Response {
  return new Response(JSON.stringify({ message: { content: PLAN }, done: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function sseFramesForPlan(): Response {
  const encoder = new TextEncoder();
  const frames = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: PLAN } }] })}\n\n`,
    "data: [DONE]\n\n",
  ];
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(frames.join("")));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("provider wire fragments from the normalized config", () => {
  it("openai: no effort configured → no reasoning_effort on the wire", async () => {
    setConfigValue("providers.openai.model", "gpt-test");
    process.env.OPENAI_API_KEY = "sk-test";
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_url: string | URL, init?: { body?: string }) => {
      bodies.push(JSON.parse(init?.body ?? "{}") as Record<string, unknown>);
      return jsonPlanResponse();
    });
    await new OpenAIProvider().plan(CTX);
    expect(bodies[0]).not.toHaveProperty("reasoning_effort");
  });

  it("openai: configured effort rides as reasoning_effort", async () => {
    setConfigValue("providers.openai.model", "gpt-test");
    setThinkingConfig("openai", { effort: "high" });
    process.env.OPENAI_API_KEY = "sk-test";
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_url: string | URL, init?: { body?: string }) => {
      const current = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
      bodies.push(current);
      return current["stream"] === true ? sseFramesForPlan() : jsonPlanResponse();
    });
    await new OpenAIProvider().plan(CTX);
    await new OpenAIProvider().planStream(CTX);
    expect(bodies[0]?.["reasoning_effort"]).toBe("high");
    expect(bodies[1]?.["reasoning_effort"]).toBe("high");
  });

  it("deepseek: no mode configured → no thinking object; explicit mode maps to the wire", async () => {
    setConfigValue("providers.deepseek.model", "deepseek-v4-pro");
    process.env.DEEPSEEK_API_KEY = "sk-test";
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_url: string | URL, init?: { body?: string }) => {
      bodies.push(JSON.parse(init?.body ?? "{}") as Record<string, unknown>);
      return sseFramesForPlan();
    });
    const provider = new DeepSeekProvider();
    await provider.plan(CTX);
    expect(bodies[0]).not.toHaveProperty("thinking");

    setThinkingConfig("deepseek", { mode: "on" });
    await provider.plan(CTX);
    expect(bodies[1]?.["thinking"]).toEqual({ type: "enabled" });

    setThinkingConfig("deepseek", { mode: "off" });
    await provider.planStream(CTX);
    expect(bodies[2]?.["thinking"]).toEqual({ type: "disabled" });
  });

  it("anthropic: effort preset selects the budget; explicit budget wins", async () => {
    setConfigValue("providers.anthropic.model", "claude-test");
    setThinkingConfig("anthropic", { mode: "on", effort: "low" });
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_url: string | URL, init?: { body?: string }) => {
      bodies.push(JSON.parse(init?.body ?? "{}") as Record<string, unknown>);
      return anthropicSse();
    });
    const provider = new AnthropicProvider();
    await provider.plan(CTX);
    expect(bodies[0]?.["thinking"]).toEqual({ type: "enabled", budget_tokens: EFFORT_BUDGETS.low });

    setConfigValue("providers.anthropic.thinkingBudget", "7777");
    await provider.plan(CTX);
    expect(bodies[1]?.["thinking"]).toEqual({ type: "enabled", budget_tokens: 7777 });

    setThinkingConfig("anthropic", { mode: "off", budget: null });
    await provider.plan(CTX);
    expect(bodies[2]).not.toHaveProperty("thinking");
  });

  it("gemini: mode off pins budget 0; mode on without budget is dynamic; effort presets apply", async () => {
    setConfigValue("providers.gemini.model", "gemini-test");
    process.env.GOOGLE_API_KEY = "g-test";
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_url: string | URL, init?: { body?: string }) => {
      bodies.push(JSON.parse(init?.body ?? "{}") as Record<string, unknown>);
      return geminiSse();
    });
    const provider = new GeminiProvider();
    const budgetOf = (index: number): unknown =>
      (
        (bodies[index]?.["generationConfig"] as Record<string, unknown>)?.["thinkingConfig"] as
          | Record<string, unknown>
          | undefined
      )?.["thinkingBudget"];

    await provider.plan(CTX);
    expect(budgetOf(0)).toBeUndefined();

    setThinkingConfig("gemini", { mode: "off" });
    await provider.plan(CTX);
    expect(budgetOf(1)).toBe(0);

    setThinkingConfig("gemini", { mode: "on" });
    await provider.plan(CTX);
    expect(budgetOf(2)).toBe(-1);

    setThinkingConfig("gemini", { effort: "medium" });
    await provider.plan(CTX);
    expect(budgetOf(3)).toBe(EFFORT_BUDGETS.medium);
  });

  it("ollama: normalized mode maps to think true/false; legacy think still works", async () => {
    setConfigValue("providers.ollama.model", "llama-test");
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async (_url: string | URL, init?: { body?: string }) => {
      bodies.push(JSON.parse(init?.body ?? "{}") as Record<string, unknown>);
      return ollamaResponse();
    });
    const provider = new OllamaProvider();
    await provider.plan(CTX);
    expect(bodies[0]).not.toHaveProperty("think");

    setThinkingConfig("ollama", { mode: "on" });
    await provider.plan(CTX);
    expect(bodies[1]?.["think"]).toBe(true);

    setThinkingConfig("ollama", { mode: "off" });
    await provider.plan(CTX);
    expect(bodies[2]?.["think"]).toBe(false);

    setThinkingConfig("ollama", { mode: null });
    setConfigValue("providers.ollama.think", "true"); // legacy path
    await provider.plan(CTX);
    expect(bodies[3]?.["think"]).toBe(true);
  });
});
