import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DeepSeekProvider, apiErrorMessage, collectStreamText } from "../src/providers/deepseek.js";
import type { PlanningContext } from "@tau/core";

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function sseFrame(delta: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`;
}

const ctx: PlanningContext = {
  intent: "find all ts files",
  toolCatalog: "- file.find [risk:low] find files",
  skillCatalog: "",
  platform: "linux",
  cwd: "/tmp",
};

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.TAU_HOME;
  if (tempHome) fs.rmSync(tempHome, { recursive: true, force: true });
  tempHome = undefined;
});

let tempHome: string | undefined;

/** Point TAU_HOME at a fresh temp dir with an explicit deepseek model configured. */
function useTempModelHome(model = "deepseek-chat"): void {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "tau-ds-provider-"));
  process.env.TAU_HOME = tempHome;
  fs.writeFileSync(
    path.join(tempHome, "config.json"),
    JSON.stringify({ providers: { deepseek: { model } } }),
  );
}

describe("collectStreamText (SSE wire parsing)", () => {
  it("accumulates content deltas across chunk boundaries split mid-frame", async () => {
    const whole = await collectStreamText(
      sseStream([`data: {"choices":[{"delta":{"content":"hello"}}]}\n\n`]),
    );
    expect(whole.text).toBe("hello");

    // Split a single JSON frame across two transport chunks.
    const split = await collectStreamText(
      sseStream([`data: {"choices":[{"delta":{"content":"HE`, `LLO"}}]}\n\ndata: [DONE]\n\n`]),
    );
    expect(split.text).toBe("HELLO");
  });

  it("stops at [DONE] and ignores anything after it", async () => {
    const result = await collectStreamText(
      sseStream([sseFrame({ content: "a" }), "data: [DONE]\n\n", sseFrame({ content: "LEAK" })]),
    );
    expect(result.text).toBe("a");
  });

  it("collects reasoning_content separately and keeps it out of the plan text", async () => {
    const result = await collectStreamText(
      sseStream([
        sseFrame({ reasoning_content: "thinking..." }),
        sseFrame({ reasoning_content: " still thinking" }),
        sseFrame({ content: '{"explanation":"x"' }),
        sseFrame({ content: "}" }),
        "data: [DONE]\n\n",
      ]),
    );
    expect(result.reasoning).toBe("thinking... still thinking");
    expect(result.text).toBe('{"explanation":"x"}');
  });

  it("captures usage from a trailing usage-only chunk", async () => {
    const result = await collectStreamText(
      sseStream([
        sseFrame({ content: "ok" }),
        `data: ${JSON.stringify({ choices: [], usage: { total_tokens: 42 } })}\n\n`,
        "data: [DONE]\n\n",
      ]),
    );
    expect(result.text).toBe("ok");
    expect(result.usage).toEqual({ total_tokens: 42 });
  });

  it("ignores SSE comments and blank lines", async () => {
    const result = await collectStreamText(
      sseStream([": keep-alive comment\n\n", "\n", sseFrame({ content: "z" }), "data: [DONE]\n\n"]),
    );
    expect(result.text).toBe("z");
  });

  it("throws on a non-JSON data frame", async () => {
    await expect(collectStreamText(sseStream(["data: {broken\n\n"]))).rejects.toThrow(
      /non-JSON data frame/,
    );
  });

  it("throws when the stream closes before any content", async () => {
    await expect(collectStreamText(sseStream([": only comments\n\n"]))).rejects.toThrow(
      /closed before any content/,
    );
  });

  it("accepts a stream that ends without [DONE] once text arrived", async () => {
    const result = await collectStreamText(sseStream([sseFrame({ content: "partial" })]));
    expect(result.text).toBe("partial");
  });
});

describe("apiErrorMessage", () => {
  it("extracts the provider error message and adds auth hint", () => {
    const message = apiErrorMessage(
      401,
      JSON.stringify({ error: { message: "invalid api key", type: "auth" } }),
    );
    expect(message).toContain("invalid api key");
    expect(message).toContain("DEEPSEEK_API_KEY");
    expect(message).toContain("401");
  });

  it("hints on rate limit and server errors", () => {
    expect(apiErrorMessage(429, "x")).toContain("rate limited");
    expect(apiErrorMessage(503, "x")).toContain("retry later");
  });

  it("falls back to raw body text", () => {
    expect(apiErrorMessage(400, "plain failure")).toContain("plain failure");
  });
});

describe("DeepSeekProvider", () => {
  // plan() resolves the model from config/catalog — give every test an
  // explicit model so resolution never touches the network stub.
  beforeEach(() => useTempModelHome());

  it("is unavailable without DEEPSEEK_API_KEY and explains why", async () => {
    const provider = new DeepSeekProvider();
    expect(await provider.isAvailable()).toBe(false);
    expect(provider.unavailableReason()).toContain("DEEPSEEK_API_KEY");
  });

  it("is available when the key is present", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    expect(await new DeepSeekProvider().isAvailable()).toBe(true);
  });

  it("streams a plan and validates it through the shared pipeline", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    let capturedBody: string | undefined;
    let capturedUrl: string | undefined;
    vi.stubGlobal("fetch", async (url: string | URL, init?: { body?: string }) => {
      capturedUrl = String(url);
      capturedBody = init?.body;
      const plan = JSON.stringify({
        explanation: "Find files",
        steps: [{ kind: "tool", tool: "file.find", args: { pattern: "*.ts" }, reason: "r" }],
        selfAssessedRisk: "low",
      });
      const frames = [
        sseFrame({ content: plan.slice(0, 10) }),
        sseFrame({ content: plan.slice(10) }),
        "data: [DONE]\n\n",
      ];
      return new Response(sseStream(frames), { status: 200 });
    });

    const plan = await new DeepSeekProvider().plan(ctx);
    expect(plan.steps[0]?.tool).toBe("file.find");
    expect(capturedUrl).toBe("https://api.deepseek.com/chat/completions");
    const body = JSON.parse(capturedBody ?? "{}") as {
      stream?: boolean;
      stream_options?: { include_usage?: boolean };
      model?: string;
      max_tokens?: number;
    };
    expect(body.stream).toBe(true);
    expect(body.stream_options?.include_usage).toBe(true);
    expect(body.model).toBe("deepseek-chat");
    expect(body.max_tokens).toBeGreaterThan(0);
  });

  it("maps API errors to readable messages", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ error: { message: "auth failed" } }), { status: 401 }),
    );
    await expect(new DeepSeekProvider().plan(ctx)).rejects.toThrow(/DeepSeek API error 401/);
  });

  it("respects the configured model and baseUrl", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    process.env.TAU_HOME = "/tmp/tau-deepseek-cfg";
    const fs = await import("node:fs");
    fs.mkdirSync("/tmp/tau-deepseek-cfg", { recursive: true });
    fs.writeFileSync(
      "/tmp/tau-deepseek-cfg/config.json",
      JSON.stringify({
        providers: {
          deepseek: { model: "deepseek-reasoner", baseUrl: "https://gw.example.com/v1" },
        },
      }),
    );
    let capturedUrl: string | undefined;
    let capturedModel: string | undefined;
    vi.stubGlobal("fetch", async (url: string | URL, init?: { body?: string }) => {
      capturedUrl = String(url);
      capturedModel = (JSON.parse(init?.body ?? "{}") as { model?: string }).model;
      return new Response(
        sseStream([
          sseFrame({
            content:
              '{"explanation":"e","steps":[{"kind":"shell","command":"echo hi","reason":"r"}]}',
          }),
          "data: [DONE]\n\n",
        ]),
        {
          status: 200,
        },
      );
    });
    try {
      const plan = await new DeepSeekProvider().plan(ctx);
      expect(capturedUrl).toBe("https://gw.example.com/v1/chat/completions");
      expect(capturedModel).toBe("deepseek-reasoner");
      expect(plan.steps[0]?.command).toBe("echo hi");
    } finally {
      fs.rmSync("/tmp/tau-deepseek-cfg", { recursive: true, force: true });
      delete process.env.TAU_HOME;
    }
  });
});
