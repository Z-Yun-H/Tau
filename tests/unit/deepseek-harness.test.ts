import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { GenerateOptions, LlmAdapter } from "@deepseek-ai/dsh-llm";
import {
  DeepSeekProvider,
  apiErrorMessage,
  createDeepSeekHarnessAdapter,
  httpErrorCode,
  loadDshLlm,
  mapWireFinishReason,
  mapWireUsage,
  resetDshLlmCache,
  setDshLlmLoaderForTests,
} from "../../src/ai/providers/deepseek.js";
import type { DshLlmBundle, HarnessConnection } from "../../src/ai/providers/deepseek.js";
import type { PlanningContext } from "../../src/types.js";

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

function finishFrame(reason: string, usage?: Record<string, unknown>): string {
  return `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: reason }], usage })}\n\n`;
}

const PLAN_JSON = JSON.stringify({
  explanation: "Find files",
  steps: [{ kind: "tool", tool: "file.find", args: { pattern: "*.ts" }, reason: "r" }],
  selfAssessedRisk: "low",
});

const ctx: PlanningContext = {
  intent: "find all ts files",
  toolCatalog: "- file.find [risk:low] find files",
  skillCatalog: "",
  platform: "linux",
  cwd: "/tmp",
};

const connection: HarnessConnection = {
  baseUrl: () => "https://api.deepseek.com",
  apiKey: () => "sk-test",
};

let llm: DshLlmBundle | null = null;

async function harness(): Promise<DshLlmBundle> {
  llm ??= await loadDshLlm();
  if (!llm) throw new Error("dsh-llm must be installed for harness tests");
  return llm;
}

/** Collect a chunk stream into an array. */
async function drain(adapter: LlmAdapter, options: GenerateOptions): Promise<unknown[]> {
  const chunks: unknown[] = [];
  for await (const chunk of adapter.stream(options)) chunks.push(chunk);
  return chunks;
}

function planOptions(model = "deepseek-chat"): GenerateOptions {
  return {
    provider: "deepseek",
    model,
    system: "You plan.",
    messages: [{ id: "t", role: "user", content: [{ type: "text", text: "hi" }] }],
    maxTokens: 8192,
  } as unknown as GenerateOptions;
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.TAU_HOME;
  if (tempHome) fs.rmSync(tempHome, { recursive: true, force: true });
  tempHome = undefined;
  setDshLlmLoaderForTests(undefined);
  resetDshLlmCache();
});

let tempHome: string | undefined;

/** Point TAU_HOME at a fresh temp dir with an explicit deepseek model configured. */
function useTempModelHome(model = "deepseek-chat"): void {
  tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "tau-ds-harness-"));
  process.env.TAU_HOME = tempHome;
  fs.writeFileSync(
    path.join(tempHome, "config.json"),
    JSON.stringify({ providers: { deepseek: { model } } }),
  );
}

describe("mapWireUsage (official disjoint-count mapping)", () => {
  it("subtracts cached tokens from input and reports them separately", () => {
    const usage = mapWireUsage({
      prompt_tokens: 100,
      completion_tokens: 20,
      prompt_tokens_details: { cached_tokens: 60 },
    });
    expect(usage.inputTokens).toBe(40);
    expect(usage.outputTokens).toBe(20);
    expect(usage.cacheReadTokens).toBe(60);
  });

  it("falls back to the legacy prompt_cache_hit_tokens field", () => {
    const usage = mapWireUsage({
      prompt_tokens: 90,
      completion_tokens: 10,
      prompt_cache_hit_tokens: 30,
    });
    expect(usage.inputTokens).toBe(60);
    expect(usage.cacheReadTokens).toBe(30);
  });

  it("maps reasoning tokens when the wire reports them", () => {
    const usage = mapWireUsage({
      prompt_tokens: 10,
      completion_tokens: 50,
      completion_tokens_details: { reasoning_tokens: 35 },
    });
    expect(usage.reasoningTokens).toBe(35);
    expect(usage.cacheReadTokens).toBeUndefined();
  });

  it("omits optional fields the wire does not report", () => {
    const usage = mapWireUsage({ prompt_tokens: 5, completion_tokens: 5 });
    expect(usage).toEqual({ inputTokens: 5, outputTokens: 5 });
  });
});

describe("mapWireFinishReason (official vocabulary)", () => {
  it("maps stop, tool_calls and length onto the harness vocabulary", () => {
    expect(mapWireFinishReason("stop")).toEqual({ kind: "stop" });
    expect(mapWireFinishReason("tool_calls")).toEqual({ kind: "tool-calls" });
    expect(mapWireFinishReason("length")).toEqual({ kind: "max-tokens" });
  });

  it("turns unrecognized reasons into an error finish with an uppercased code", () => {
    const reason = mapWireFinishReason("content_filter");
    expect(reason).toEqual({
      kind: "error",
      failure: { message: "model stopped: content_filter", code: "CONTENT_FILTER" },
    });
  });
});

describe("httpErrorCode (official status mapping)", () => {
  it("maps auth, quota, rate limit, context window and server classes", async () => {
    const bundle = await harness();
    expect(httpErrorCode(bundle, 401)).toBe("AUTH");
    expect(httpErrorCode(bundle, 403)).toBe("AUTH");
    expect(httpErrorCode(bundle, 429)).toBe("RATE_LIMIT");
    expect(httpErrorCode(bundle, 500)).toBe("SERVER");
    expect(httpErrorCode(bundle, 503)).toBe("SERVER");
    expect(httpErrorCode(bundle, 400)).toBe("INVALID_REQUEST");
    expect(httpErrorCode(bundle, 418)).toBe("HTTP_418");
  });

  it("classifies quota and context-window detail via the shared official classifiers", async () => {
    const bundle = await harness();
    expect(httpErrorCode(bundle, 402, { message: "Insufficient Balance" })).toBe(
      bundle.QUOTA_EXCEEDED_CODE,
    );
    expect(
      httpErrorCode(bundle, 400, {
        message: "This model's maximum context length is 65536 tokens",
      }),
    ).toBe(bundle.CONTEXT_WINDOW_EXCEEDED_CODE);
  });
});

describe("DeepSeek harness adapter (official StreamChunk protocol)", () => {
  it("emits the canonical chunk sequence with block-ends deferred to [DONE]", async () => {
    const bundle = await harness();
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          sseStream([
            sseFrame({ reasoning_content: "think" }),
            sseFrame({ content: '{"expl' }),
            sseFrame({ reasoning_content: " more" }),
            sseFrame({ content: 'anation":"x"}' }),
            finishFrame("stop", { prompt_tokens: 10, completion_tokens: 5 }),
            "data: [DONE]\n\n",
          ]),
          { status: 200 },
        ),
    );
    const adapter = createDeepSeekHarnessAdapter(bundle, connection);
    const chunks = (await drain(adapter, planOptions())) as Array<Record<string, unknown>>;

    const types = chunks.map((chunk) => chunk["type"]);
    // reasoning opens first (official per-choice order), then text; ALL
    // block-ends land at [DONE] in open order, usage before finish.
    expect(types).toEqual([
      "block-start",
      "reasoning-delta",
      "block-start",
      "text-delta",
      "reasoning-delta",
      "text-delta",
      "block-end",
      "block-end",
      "usage",
      "finish",
    ]);
    const blockStarts = chunks.filter(
      (chunk) => chunk["type"] === "block-start",
    ) as unknown as Array<{
      index: number;
      blockType: string;
    }>;
    expect(blockStarts.map((chunk) => chunk.blockType)).toEqual(["reasoning", "text"]);
    const blockEnds = chunks.filter((chunk) => chunk["type"] === "block-end") as unknown as Array<{
      index: number;
      block: { type: string; text: string };
    }>;
    expect(blockEnds.map((chunk) => chunk.index)).toEqual([0, 1]);
    expect(blockEnds[0]?.block).toEqual({ type: "reasoning", text: "think more" });
    expect(blockEnds[1]?.block).toEqual({ type: "text", text: '{"explanation":"x"}' });
    const usage = chunks.find((chunk) => chunk["type"] === "usage") as unknown as {
      usage: { inputTokens: number; outputTokens: number };
    };
    const finish = chunks.at(-1) as unknown as { reason: { kind: string } };
    expect(usage.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(finish.reason).toEqual({ kind: "stop" });
  });

  it("translates tool-call deltas with branded call ids", async () => {
    const bundle = await harness();
    const callOpen = {
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: "call_1", function: { name: "file.find", arguments: '{"pa' } },
            ],
          },
        },
      ],
    };
    const callMore = {
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ttern":"x"}' } }] } }],
    };
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          sseStream([
            `data: ${JSON.stringify(callOpen)}\n\n`,
            `data: ${JSON.stringify(callMore)}\n\n`,
            finishFrame("tool_calls"),
            "data: [DONE]\n\n",
          ]),
          { status: 200 },
        ),
    );
    const adapter = createDeepSeekHarnessAdapter(bundle, connection);
    const chunks = (await drain(adapter, planOptions())) as Array<Record<string, unknown>>;

    const deltas = chunks.filter(
      (chunk) => chunk["type"] === "tool-call-delta",
    ) as unknown as Array<{
      index: number;
      id: string;
      name?: string;
      argumentsDelta: string;
    }>;
    expect(deltas).toHaveLength(2);
    expect(deltas[0]).toMatchObject({
      index: 0,
      id: "call_1",
      name: "file.find",
      argumentsDelta: '{"pa',
    });
    expect(deltas[1]).toMatchObject({ index: 0, id: "call_1", argumentsDelta: 'ttern":"x"}' });

    const end = chunks.find((chunk) => chunk["type"] === "block-end") as unknown as {
      block: { type: string; id: string; name: string; arguments: string };
    };
    expect(end.block).toEqual({
      type: "tool-call",
      id: "call_1",
      name: "file.find",
      arguments: '{"pattern":"x"}',
    });
    const finish = chunks.at(-1) as unknown as { reason: { kind: string } };
    expect(finish.reason).toEqual({ kind: "tool-calls" });
  });

  it("maps a degenerate empty stop to an EMPTY_RESPONSE error finish", async () => {
    const bundle = await harness();
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(sseStream([finishFrame("stop"), "data: [DONE]\n\n"]), { status: 200 }),
    );
    const adapter = createDeepSeekHarnessAdapter(bundle, connection);
    const chunks = (await drain(adapter, planOptions())) as Array<Record<string, unknown>>;
    const finish = chunks.at(-1) as unknown as {
      reason: { kind: string; failure: { code: string } };
    };
    expect(finish.reason.kind).toBe("error");
    expect(finish.reason.failure.code).toBe(bundle.EMPTY_RESPONSE_CODE);
  });

  it("aborts with MALFORMED_RESPONSE on a non-JSON data frame", async () => {
    const bundle = await harness();
    vi.stubGlobal(
      "fetch",
      async () => new Response(sseStream(["data: {broken\n\n"]), { status: 200 }),
    );
    const adapter = createDeepSeekHarnessAdapter(bundle, connection);
    await expect(drain(adapter, planOptions())).rejects.toThrowError(
      expect.objectContaining({ code: "MALFORMED_RESPONSE" }),
    );
  });

  it("aborts with STREAM_CLOSED when the stream ends without [DONE]", async () => {
    const bundle = await harness();
    vi.stubGlobal(
      "fetch",
      async () => new Response(sseStream([sseFrame({ content: "partial" })]), { status: 200 }),
    );
    const adapter = createDeepSeekHarnessAdapter(bundle, connection);
    await expect(drain(adapter, planOptions())).rejects.toThrowError(
      expect.objectContaining({ code: "STREAM_CLOSED" }),
    );
  });

  it("maps a max-tokens finish_reason onto the max-tokens finish", async () => {
    const bundle = await harness();
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          sseStream([sseFrame({ content: "cut" }), finishFrame("length"), "data: [DONE]\n\n"]),
          { status: 200 },
        ),
    );
    const adapter = createDeepSeekHarnessAdapter(bundle, connection);
    const chunks = (await drain(adapter, planOptions())) as Array<Record<string, unknown>>;
    const finish = chunks.at(-1) as unknown as { reason: { kind: string } };
    expect(finish.reason).toEqual({ kind: "max-tokens" });
  });
});

describe("DeepSeek harness adapter (HTTP boundary)", () => {
  it("sends the official wire request with Tau attribution headers", async () => {
    const bundle = await harness();
    let capturedUrl: string | undefined;
    let capturedInit: { headers?: Record<string, string>; body?: string } | undefined;
    vi.stubGlobal("fetch", async (url: string | URL, init?: Record<string, unknown>) => {
      capturedUrl = String(url);
      capturedInit = init as { headers?: Record<string, string>; body?: string };
      return new Response(sseStream([sseFrame({ content: PLAN_JSON }), "data: [DONE]\n\n"]), {
        status: 200,
      });
    });
    const adapter = createDeepSeekHarnessAdapter(bundle, connection);
    await drain(adapter, planOptions("deepseek-reasoner"));

    expect(capturedUrl).toBe("https://api.deepseek.com/chat/completions");
    const headers = capturedInit?.headers ?? {};
    expect(headers["authorization"]).toBe("Bearer sk-test");
    expect(headers["accept"]).toBe("text/event-stream");
    expect(headers["user-agent"]).toMatch(/^tau\/\d/);
    // Official RFC 9110 §10.1.5 form: product/version (+url)
    expect(headers["user-agent"]).toContain("(+https://github.com/Z-Yun-H/Tau)");

    const body = JSON.parse(capturedInit?.body ?? "{}") as {
      model?: string;
      stream?: boolean;
      stream_options?: { include_usage?: boolean };
      max_tokens?: number;
      messages?: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe("deepseek-reasoner");
    expect(body.stream).toBe(true);
    expect(body.stream_options?.include_usage).toBe(true);
    expect(body.max_tokens).toBe(8192);
    expect(body.messages).toEqual([
      { role: "system", content: "You plan." },
      { role: "user", content: "hi" },
    ]);
  });

  it("maps a 401 to an AUTH LlmError carrying Tau's readable message and status", async () => {
    const bundle = await harness();
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ error: { message: "auth failed" } }), {
          status: 401,
          headers: { "x-request-id": "req-42" },
        }),
    );
    const adapter = createDeepSeekHarnessAdapter(bundle, connection);
    const error = (await drain(adapter, planOptions()).catch(
      (value: unknown) => value,
    )) as Error & {
      code?: string;
      failure?: { code: string; status?: number; requestId?: string };
    };
    expect(error).toBeInstanceOf(bundle.LlmError);
    expect(error.failure?.code).toBe("AUTH");
    expect(error.code).toBe("AUTH");
    // Official LlmError keeps provider facts on the serializable `failure`.
    expect(error.failure?.status).toBe(401);
    expect(error.failure?.requestId).toBe("req-42");
    expect(error.message).toContain("DeepSeek API error 401");
    expect(error.message).toContain("auth failed");
  });

  it("attaches the parsed Retry-After delay", async () => {
    const bundle = await harness();
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ error: { message: "slow down" } }), {
          status: 429,
          headers: { "retry-after": "3" },
        }),
    );
    const adapter = createDeepSeekHarnessAdapter(bundle, connection);
    const error = (await drain(adapter, planOptions()).catch(
      (value: unknown) => value,
    )) as Error & {
      failure?: { code: string; providerRetryAfterMs?: number };
    };
    expect(error.failure?.code).toBe("RATE_LIMIT");
    expect(error.failure?.providerRetryAfterMs).toBe(3000);
  });

  it("wraps transport failures in a TRANSPORT LlmError with the cause chain", async () => {
    const bundle = await harness();
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const adapter = createDeepSeekHarnessAdapter(bundle, connection);
    const error = (await drain(adapter, planOptions()).catch(
      (value: unknown) => value,
    )) as Error & {
      code?: string;
      cause?: unknown;
    };
    expect(error.code).toBe("TRANSPORT");
    expect(error.message).toContain("https://api.deepseek.com");
    expect((error.cause as Error).message).toBe("fetch failed");
  });

  it("maps a missing response body to EMPTY_RESPONSE", async () => {
    const bundle = await harness();
    vi.stubGlobal("fetch", async () => new Response(null, { status: 200 }) as unknown as Response);
    const adapter = createDeepSeekHarnessAdapter(bundle, connection);
    await expect(drain(adapter, planOptions())).rejects.toThrowError(
      expect.objectContaining({ code: "EMPTY_RESPONSE" }),
    );
  });
});

describe("DeepSeekProvider.plan (harness path)", () => {
  // plan() resolves the model from config/catalog first — give every test an
  // explicit model so resolution never hits the stubbed fetch.
  beforeEach(() => useTempModelHome());

  it("streams a plan through the official BlockAssembler", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    let sawUserAgent: string | undefined;
    vi.stubGlobal(
      "fetch",
      async (_url: string | URL, init?: { headers?: Record<string, string> }) => {
        sawUserAgent = init?.headers?.["user-agent"];
        return new Response(
          sseStream([
            sseFrame({ content: PLAN_JSON.slice(0, 12) }),
            sseFrame({ content: PLAN_JSON.slice(12) }),
            "data: [DONE]\n\n",
          ]),
          { status: 200 },
        );
      },
    );
    const plan = await new DeepSeekProvider().plan(ctx);
    expect(plan.steps[0]?.tool).toBe("file.find");
    expect(sawUserAgent).toMatch(/^tau\//);
  });

  it("uses the trimmed credential per the official assertUsableApiKey contract", async () => {
    process.env.DEEPSEEK_API_KEY = "  sk-test  ";
    let sawAuthorization: string | undefined;
    vi.stubGlobal(
      "fetch",
      async (_url: string | URL, init?: { headers?: Record<string, string> }) => {
        sawAuthorization = init?.headers?.["authorization"];
        return new Response(sseStream([sseFrame({ content: PLAN_JSON }), "data: [DONE]\n\n"]), {
          status: 200,
        });
      },
    );
    await new DeepSeekProvider().plan(ctx);
    expect(sawAuthorization).toBe("Bearer sk-test");
  });

  it("rejects an unusable credential before any request is made", async () => {
    process.env.DEEPSEEK_API_KEY = "bad key\nwith newline";
    let fetchCalled = false;
    vi.stubGlobal("fetch", async () => {
      fetchCalled = true;
      return new Response(sseStream([]), { status: 200 });
    });
    await expect(new DeepSeekProvider().plan(ctx)).rejects.toThrow(/DEEPSEEK_API_KEY/);
    expect(fetchCalled).toBe(false);
  });

  it("surfaces in-band error finishes as actionable failures", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(sseStream([finishFrame("stop"), "data: [DONE]\n\n"]), { status: 200 }),
    );
    await expect(new DeepSeekProvider().plan(ctx)).rejects.toThrow(/\[EMPTY_RESPONSE\]/);
  });
});

describe("graceful degradation (dsh-llm absent → direct path)", () => {
  beforeEach(() => useTempModelHome());

  it("falls back to the built-in streaming client without attribution headers", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    setDshLlmLoaderForTests(async () => null);
    let sawUserAgent: string | undefined;
    vi.stubGlobal(
      "fetch",
      async (_url: string | URL, init?: { headers?: Record<string, string> }) => {
        sawUserAgent = init?.headers?.["user-agent"];
        return new Response(sseStream([sseFrame({ content: PLAN_JSON }), "data: [DONE]\n\n"]), {
          status: 200,
        });
      },
    );
    const plan = await new DeepSeekProvider().plan(ctx);
    expect(plan.steps[0]?.tool).toBe("file.find");
    expect(sawUserAgent).toBeUndefined();
  });

  it("keeps apiErrorMessage parity across both paths", async () => {
    process.env.DEEPSEEK_API_KEY = "sk-test";
    setDshLlmLoaderForTests(async () => null);
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(JSON.stringify({ error: { message: "auth failed" } }), { status: 401 }),
    );
    await expect(new DeepSeekProvider().plan(ctx)).rejects.toThrow(/DeepSeek API error 401/);
    expect(apiErrorMessage(401, "x")).toContain("DEEPSEEK_API_KEY");
  });
});
