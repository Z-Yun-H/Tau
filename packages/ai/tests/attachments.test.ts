/**
 * Image-attachment tests (issue #135): the prompt layer's annotation
 * folding (byte-identical without attachments), the four vision-capable
 * providers' wire shapes against a stubbed fetch, and the capability map
 * (who sets supportsVision — the honest-degradation contract).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setConfigValue, type ImageAttachment } from "@tau/core";
import { planningContext, renderAttachmentNotes } from "../src/prompt.js";
import { OpenAIProvider } from "../src/providers/openai.js";
import { AnthropicProvider } from "../src/providers/anthropic.js";
import { GeminiProvider } from "../src/providers/gemini.js";
import { OllamaProvider } from "../src/providers/ollama.js";
import { resetProviders, registerProviderBuiltins, getProvider } from "../src/registry.js";

const ORIGINAL_FETCH = globalThis.fetch;
let tmp = "";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-attachments-"));
  process.env.TAU_HOME = path.join(tmp, "home");
  globalThis.fetch = ORIGINAL_FETCH;
  resetProviders();
  registerProviderBuiltins();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TAU_HOME;
  fs.rmSync(tmp, { recursive: true, force: true });
  globalThis.fetch = ORIGINAL_FETCH;
});

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAADZmY90AAAA" as const; // 24-byte 2x3 header

const ATTACHMENT: ImageAttachment = {
  kind: "image",
  name: "shot.png",
  mediaType: "image/png",
  dataBase64: PNG_B64,
};

const PLAN_JSON = JSON.stringify({
  explanation: "ack",
  steps: [{ kind: "tool", tool: "file.find", args: { pattern: "*.ts" }, reason: "find" }],
  selfAssessedRisk: "low",
});

/** Minimal 24-byte PNG header buffer (magic + IHDR dims). */
function pngHeader(width = 2, height = 3): Uint8Array {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(b.buffer);
  view.setUint32(8, 13);
  b.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  view.setUint32(16, width);
  view.setUint32(20, height);
  return b;
}

describe("prompt layer — attachment annotations (issue #135)", () => {
  it("folds one annotation per image into the intent, payload carried on ctx", () => {
    const ctx = planningContext("what is this", "", undefined, [ATTACHMENT], true);
    expect(ctx.intent).toContain("<attachments>");
    expect(ctx.intent).toContain("[image 1: shot.png, image/png — attached to this message]");
    expect(ctx.intent.startsWith("what is this")).toBe(true);
    expect(ctx.attachments).toEqual([ATTACHMENT]);
  });

  it("text-only providers get the honest dropped wording", () => {
    const ctx = planningContext("look", "", undefined, [ATTACHMENT], false);
    expect(ctx.intent).toContain("this provider cannot see images — the image was dropped");
    expect(ctx.intent).not.toContain("attached to this message");
  });

  it("is byte-identical without attachments (pinned)", () => {
    const plain = planningContext("find logs", "");
    const empty = planningContext("find logs", "", undefined, [], true);
    expect(empty).toEqual(plain);
    expect(Object.prototype.hasOwnProperty.call(plain, "attachments")).toBe(false);
  });

  it("renders multiple images and caps long display names", () => {
    const notes = renderAttachmentNotes(
      [
        ATTACHMENT,
        { kind: "image", mediaType: "image/jpeg", dataBase64: "AAAA" },
        { kind: "image", name: "x".repeat(80), mediaType: "image/gif", dataBase64: "AAAA" },
      ],
      true,
    );
    expect(notes).toContain("[image 2: image 2, image/jpeg — attached to this message]");
    expect(notes).toContain(`[image 3: ${"x".repeat(60)}…, image/gif — attached to this message]`);
    expect(notes.startsWith("<attachments>")).toBe(true);
    expect(notes.endsWith("</attachments>")).toBe(true);
  });
});

describe("OpenAI wire — image_url content parts", () => {
  it("sends a multipart content array when attachments ride along", async () => {
    setConfigValue("providers.openai.model", "gpt-vision-test");
    process.env.OPENAI_API_KEY = "sk-test";
    const calls: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: string | URL, init: RequestInit = {}) => {
      calls.push(init);
      return new Response(JSON.stringify({ choices: [{ message: { content: PLAN_JSON } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const provider = new OpenAIProvider();
    const ctx = planningContext("what is this", "", undefined, [ATTACHMENT], true);
    await provider.plan(ctx);
    const body = JSON.parse(String(calls[0]!.body)) as {
      messages: Array<{ role: string; content: unknown }>;
    };
    const user = body.messages[1]!;
    expect(user.role).toBe("user");
    const parts = user.content as Array<{ type: string; image_url?: { url: string } }>;
    const first = parts[0]!;
    expect(first.type).toBe("text");
    expect("text" in first ? first.text : undefined).toContain("what is this");
    expect(parts[1]!.type).toBe("image_url");
    expect(parts[1]!.image_url?.url).toBe(`data:image/png;base64,${PNG_B64}`);
  });

  it("keeps plain string content without attachments (historical wire)", async () => {
    setConfigValue("providers.openai.model", "gpt-vision-test");
    process.env.OPENAI_API_KEY = "sk-test";
    const calls: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: string | URL, init: RequestInit = {}) => {
      calls.push(init);
      return new Response(JSON.stringify({ choices: [{ message: { content: PLAN_JSON } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    await new OpenAIProvider().plan(planningContext("plain text", ""));
    const body = JSON.parse(String(calls[0]!.body)) as {
      messages: Array<{ content: unknown }>;
    };
    expect(typeof body.messages[1]!.content).toBe("string");
  });
});

describe("Anthropic wire — base64 image source blocks", () => {
  it("sends text + image blocks when attachments ride along", async () => {
    setConfigValue("providers.anthropic.model", "claude-vision-test");
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const calls: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: string | URL, init: RequestInit = {}) => {
      calls.push(init);
      void calls;
      return new Response(
        `event: content_block_delta\ndata: ${JSON.stringify({
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: PLAN_JSON },
        })}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n`,
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    });
    const ctx = planningContext("what is this", "", undefined, [ATTACHMENT], true);
    await new AnthropicProvider().plan(ctx);
    const body = JSON.parse(String(calls[0]!.body)) as {
      messages: Array<{ content: unknown }>;
    };
    const blocks = body.messages[0]!.content as Array<Record<string, unknown>>;
    expect(blocks[0]).toMatchObject({ type: "text" });
    expect(blocks[1]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/png", data: PNG_B64 },
    });
  });
});

describe("Gemini wire — inline_data parts", () => {
  it("sends text + inlineData parts when attachments ride along", async () => {
    setConfigValue("providers.gemini.model", "gemini-vision-test");
    process.env.GEMINI_API_KEY = "g-test";
    const calls: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: string | URL, init: RequestInit = {}) => {
      calls.push(init);
      return new Response(
        `data: ${JSON.stringify({
          candidates: [{ content: { parts: [{ text: PLAN_JSON }] } }],
        })}\n\n`,
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    });
    const ctx = planningContext("what is this", "", undefined, [ATTACHMENT], true);
    await new GeminiProvider().plan(ctx);
    const body = JSON.parse(String(calls[0]!.body)) as {
      contents: Array<{ parts: Array<Record<string, unknown>> }>;
    };
    const parts = body.contents[0]!.parts;
    expect(parts[0]).toMatchObject({ text: expect.stringContaining("what is this") });
    expect(parts[1]).toEqual({
      inline_data: { mime_type: "image/png", data: PNG_B64 },
    });
  });
});

describe("Ollama wire — images field", () => {
  it("attaches raw base64 strings on the user message", async () => {
    setConfigValue("providers.ollama.model", "llava-test");
    const calls: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: string | URL, init: RequestInit = {}) => {
      calls.push(init);
      return new Response(JSON.stringify({ message: { content: PLAN_JSON } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const ctx = planningContext("what is this", "", undefined, [ATTACHMENT], true);
    await new OllamaProvider().plan(ctx);
    const body = JSON.parse(String(calls[0]!.body)) as {
      messages: Array<{ role: string; content?: string; images?: string[] }>;
    };
    const user = body.messages[1]!;
    expect(user.role).toBe("user");
    expect(user.images).toEqual([PNG_B64]);
    expect(user.content).toContain("what is this");
  });
});

describe("vision capability map (supportsVision)", () => {
  it("openai/anthropic/gemini/ollama are vision-capable; deepseek/zai/mock are not", () => {
    expect(getProvider("openai")?.supportsVision).toBe(true);
    expect(getProvider("anthropic")?.supportsVision).toBe(true);
    expect(getProvider("gemini")?.supportsVision).toBe(true);
    expect(getProvider("ollama")?.supportsVision).toBe(true);
    expect(getProvider("deepseek")?.supportsVision).toBeUndefined();
    expect(getProvider("zai")?.supportsVision).toBeUndefined();
    expect(getProvider("mock")?.supportsVision).toBeUndefined();
  });
});

describe("attachment fixture sanity", () => {
  it("the PNG header fixture round-trips through base64", () => {
    const b64 = Buffer.from(pngHeader()).toString("base64");
    expect(b64.slice(0, 16)).toBe(PNG_B64.slice(0, 16));
    expect(Buffer.from(b64, "base64").byteLength).toBe(24);
  });
});
