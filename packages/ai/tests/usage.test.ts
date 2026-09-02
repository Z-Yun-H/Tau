/**
 * Usage normalization tests (issue #98) — the wire-shape matrix,
 * formatUsage, the chatJSON onUsage hook, openai's capture, and the mock
 * provider's deterministic synthetic usage.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeUsage, formatUsage } from "../src/usage.js";
import { chatJSON } from "../src/providers/http.js";
import { OpenAIProvider } from "../src/providers/openai.js";
import { MockProvider } from "../src/providers/mock.js";
import { planningContext } from "../src/prompt.js";
import { registerCoreTools } from "@tau/tools";

registerCoreTools();

const ORIGINAL_FETCH = globalThis.fetch;
let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-usage-"));
  process.env.TAU_HOME = path.join(tmp, "home");
  fs.mkdirSync(process.env.TAU_HOME, { recursive: true });
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
  delete process.env.TAU_HOME;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("normalizeUsage", () => {
  it("accepts the OpenAI-compatible wire shape", () => {
    expect(
      normalizeUsage({ prompt_tokens: 100, completion_tokens: 23, total_tokens: 123 }),
    ).toEqual({
      promptTokens: 100,
      completionTokens: 23,
      totalTokens: 123,
    });
  });

  it("accepts an already-normalized shape (deepseek mapping)", () => {
    expect(normalizeUsage({ promptTokens: 10, completionTokens: 5, totalTokens: 15 })).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    });
  });

  it("derives the total when the wire omits it", () => {
    expect(normalizeUsage({ prompt_tokens: 7, completion_tokens: 3 })?.totalTokens).toBe(10);
  });

  it("returns undefined for junk, nulls, and empty objects", () => {
    expect(normalizeUsage(undefined)).toBeUndefined();
    expect(normalizeUsage(null)).toBeUndefined();
    expect(normalizeUsage("nope")).toBeUndefined();
    expect(normalizeUsage({})).toBeUndefined();
    expect(normalizeUsage({ prompt_tokens: "many" })).toBeUndefined();
  });
});

describe("formatUsage", () => {
  it("renders the compact log form", () => {
    expect(formatUsage({ promptTokens: 100, completionTokens: 23, totalTokens: 123 })).toBe(
      "tokens=123(100/23)",
    );
  });
  it("is empty when absent", () => {
    expect(formatUsage(undefined)).toBe("");
  });
});

/** Stub JSON Response helper shared by the fetch-stubbing tests. */
const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("chatJSON onUsage hook", () => {
  it("reports the usage object of an OK JSON reply", async () => {
    const seen: unknown[] = [];
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        choices: [{ message: { content: "{}" } }],
        usage: { prompt_tokens: 11, completion_tokens: 7 },
      }),
    ) as unknown as typeof fetch;
    await chatJSON("https://x.test", {}, {}, 1000, { retries: 0, onUsage: (u) => seen.push(u) });
    expect(seen).toEqual([{ prompt_tokens: 11, completion_tokens: 7 }]);
  });

  it("stays silent when the reply carries no usage", async () => {
    const seen: unknown[] = [];
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({ choices: [{ message: { content: "{}" } }] }),
    ) as unknown as typeof fetch;
    await chatJSON("https://x.test", {}, {}, 1000, { retries: 0, onUsage: (u) => seen.push(u) });
    expect(seen).toEqual([]);
  });

  it("never lets a non-JSON reply break the text path", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("just text", { status: 200 }),
    ) as unknown as typeof fetch;
    const text = await chatJSON("https://x.test", {}, {}, 1000, {
      retries: 0,
      onUsage: () => {
        throw new Error("must not be called");
      },
    });
    expect(text).toBe("just text");
  });
});

describe("provider usage capture", () => {
  it("openai captures usage from the chat completion into lastUsage", async () => {
    const { setConfigValue } = await import("@tau/core");
    process.env["OPENAI_API_KEY"] = "test-key";
    setConfigValue("providers.openai.baseUrl", "https://stub.test/v1");
    setConfigValue("providers.openai.model", "stub-model");
    globalThis.fetch = vi.fn(async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: JSON.stringify({
                explanation: "find files",
                steps: [
                  { kind: "tool", tool: "file.find", args: { pattern: "*.ts" }, reason: "r" },
                ],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 50, completion_tokens: 12, total_tokens: 62 },
      }),
    ) as unknown as typeof fetch;
    const provider = new OpenAIProvider();
    try {
      await provider.plan(planningContext("find ts files", ""));
      expect(provider.lastUsage).toEqual({
        promptTokens: 50,
        completionTokens: 12,
        totalTokens: 62,
      });
    } finally {
      delete process.env["OPENAI_API_KEY"];
    }
  });

  it("mock reports deterministic synthetic usage from plan()", async () => {
    const provider = new MockProvider();
    await provider.plan(planningContext("find all test files", ""));
    const usage = provider.lastUsage;
    expect(usage).toBeDefined();
    expect(usage?.totalTokens).toBe((usage?.promptTokens ?? 0) + (usage?.completionTokens ?? 0));
    expect(usage?.promptTokens).toBe(40 + "find all test files".length);
  });

  it("mock reflect updates the synthetic usage too", async () => {
    const provider = new MockProvider();
    await provider.reflect({
      ...planningContext("demo", ""),
      rounds: [
        {
          round: 1,
          plan: { explanation: "x", steps: [] },
          status: "ok",
          outputs: ["GOAL_COMPLETE"],
        },
      ],
    });
    expect(provider.lastUsage?.totalTokens).toBeGreaterThan(0);
  });
});
