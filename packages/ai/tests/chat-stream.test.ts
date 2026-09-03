/**
 * Unified streaming wire layer tests (v0.5.0) — each parser gets a
 * hand-built ReadableStream of wire frames (chunk boundaries deliberately
 * hostile: mid-frame, mid-multibyte) and the folded event sequence is
 * asserted. No network, no timers — pure stream folding.
 */
import { describe, it, expect } from "vitest";
import {
  consumeOpenAiCompatibleStream,
  consumeAnthropicStream,
  consumeGeminiStream,
  consumeOllamaStream,
} from "../src/chat-stream.js";
import type { ProviderStreamEvent } from "@tau/core";

const encoder = new TextEncoder();

/** Build a body stream that delivers `chunks` verbatim. */
function streamFrom(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(
  run: (onEvent?: (e: ProviderStreamEvent) => void) => Promise<string>,
): Promise<{ text: string; events: ProviderStreamEvent[] }> {
  const events: ProviderStreamEvent[] = [];
  const text = await run((event) => events.push(event));
  return { text, events };
}

describe("consumeOpenAiCompatibleStream", () => {
  it("folds reasoning_content, content and usage deltas in wire order", async () => {
    const good = [
      'data: {"choices":[{"delta":{"reasoning_content":"think A"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"{ "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"\\"x\\": 1 }"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
      "data: [DONE]\n\n",
    ].join("");
    const { text, events } = await collect((onEvent) =>
      consumeOpenAiCompatibleStream(streamFrom([good]), onEvent),
    );
    expect(text).toBe('{ "x": 1 }');
    expect(events).toEqual([
      { type: "reasoning_delta", text: "think A" },
      { type: "text_delta", text: "{ " },
      { type: "text_delta", text: '"x": 1 }' },
      { type: "usage", usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } },
    ]);
  });

  it("tolerates chunk boundaries inside frames (multi-byte safe)", async () => {
    const frame = 'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n';
    const bytes = encoder.encode(frame);
    const mid = 3 + Math.floor((bytes.length - 3) / 2); // split inside the UTF-8 text
    const a = new TextDecoder().decode(bytes.subarray(0, mid));
    const b = new TextDecoder().decode(bytes.subarray(mid));
    const { text, events } = await collect((onEvent) =>
      consumeOpenAiCompatibleStream(streamFrom([a, b]), onEvent),
    );
    expect(text).toBe("你好");
    expect(events).toEqual([{ type: "text_delta", text: "你好" }]);
  });

  it("accepts a stream that closes without [DONE] once content arrived", async () => {
    const { text } = await collect((onEvent) =>
      consumeOpenAiCompatibleStream(
        streamFrom(['data: {"choices":[{"delta":{"content":"plan"}}]}\n\n']),
        onEvent,
      ),
    );
    expect(text).toBe("plan");
  });

  it("throws when the stream closes before any content or usage", async () => {
    await expect(consumeOpenAiCompatibleStream(streamFrom(["data: [DONE]\n\n"]))).rejects.toThrow(
      /closed before any content/,
    );
  });
});

describe("consumeAnthropicStream", () => {
  const frames = [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":12,"output_tokens":0}}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"ponder"}}\n\n',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"{plan}"}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"signature_delta","signature":"sig"}}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ].join("");

  it("folds thinking/text deltas and start+delta usage", async () => {
    const { text, events } = await collect((onEvent) =>
      consumeAnthropicStream(streamFrom([frames]), onEvent),
    );
    expect(text).toBe("{plan}");
    expect(events).toEqual([
      { type: "reasoning_delta", text: "ponder" },
      { type: "text_delta", text: "{plan}" },
      { type: "usage", usage: { promptTokens: 12, completionTokens: 7, totalTokens: 19 } },
    ]);
  });

  it("surfaces provider error events as thrown errors", async () => {
    const errorStream = streamFrom([
      'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n',
    ]);
    await expect(consumeAnthropicStream(errorStream)).rejects.toThrow(/Overloaded/);
  });

  it("throws when no text and no usage arrived", async () => {
    await expect(
      consumeAnthropicStream(streamFrom(['data: {"type":"message_stop"}\n\n'])),
    ).rejects.toThrow(/closed before any content/);
  });
});

describe("consumeGeminiStream", () => {
  it("folds thought parts as reasoning and plain parts as text with usage", async () => {
    const frames = [
      'data: {"candidates":[{"content":{"parts":[{"text":"thinking hard","thought":true}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"{\\"ok\\":"},{"text":"1}"}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":9,"candidatesTokenCount":4,"totalTokenCount":13}}\n\n',
    ].join("");
    const { text, events } = await collect((onEvent) =>
      consumeGeminiStream(streamFrom([frames]), onEvent),
    );
    expect(text).toBe('{"ok":1}');
    expect(events).toEqual([
      { type: "reasoning_delta", text: "thinking hard" },
      { type: "text_delta", text: '{"ok":' },
      { type: "text_delta", text: "1}" },
      { type: "usage", usage: { promptTokens: 9, completionTokens: 4, totalTokens: 13 } },
    ]);
  });

  it("throws on an empty frame stream", async () => {
    await expect(consumeGeminiStream(streamFrom([]))).rejects.toThrow(/closed before any content/);
  });
});

describe("consumeOllamaStream", () => {
  it("folds content/thinking deltas and terminal counts", async () => {
    const ndjson = [
      '{"message":{"role":"assistant","thinking":"hmm"}}\n',
      '{"message":{"role":"assistant","content":"{ \\"x\\""}}\n',
      '{"message":{"role":"assistant","content":": 1 }"}}\n',
      '{"done":true,"done_reason":"stop","prompt_eval_count":8,"eval_count":3}\n',
    ].join("");
    const { text, events } = await collect((onEvent) =>
      consumeOllamaStream(streamFrom([ndjson]), onEvent),
    );
    expect(text).toBe('{ "x": 1 }');
    expect(events).toEqual([
      { type: "reasoning_delta", text: "hmm" },
      { type: "text_delta", text: '{ "x"' },
      { type: "text_delta", text: ": 1 }" },
      { type: "usage", usage: { promptTokens: 8, completionTokens: 3, totalTokens: 11 } },
    ]);
  });

  it("throws on an empty stream", async () => {
    await expect(consumeOllamaStream(streamFrom([]))).rejects.toThrow(/closed before any content/);
  });

  it("accepts a trailing frame without a newline", async () => {
    const { text } = await collect((onEvent) =>
      consumeOllamaStream(
        streamFrom(['{"message":{"content":"tail"}}', "\n", '{"done":true}']),
        onEvent,
      ),
    );
    expect(text).toBe("tail");
  });
});
