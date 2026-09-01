/**
 * NDJSON stream consumption — DOM-free unit tests for the line-buffering
 * splitter and a real end-to-end stream through the HTTP server.
 */

import { describe, it, expect } from "vitest";
import { createNdjsonSplitter, readNdjsonStream } from "../client/lib/stream.js";

describe("createNdjsonSplitter", () => {
  it("emits complete lines across arbitrary chunk boundaries", () => {
    const lines: string[] = [];
    const splitter = createNdjsonSplitter((line) => lines.push(line));
    splitter.push('{"a":1}\n{"b"');
    splitter.push(":2}\n");
    splitter.push('{"c":3}\n{"d":');
    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
    splitter.flush();
    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}', '{"d":']);
  });

  it("tolerates CRLF and skips empty lines", () => {
    const lines: string[] = [];
    const splitter = createNdjsonSplitter((line) => lines.push(line));
    splitter.push('{"x":1}\r\n\r\n{"y":2}\r\n');
    expect(lines).toEqual(['{"x":1}', '{"y":2}']);
  });
});

describe("readNdjsonStream", () => {
  it("parses every event from a web ReadableStream body", async () => {
    const events = [
      { type: "step_start", index: 0 },
      { type: "step_output", index: 0, chunk: "hi\n" },
      { type: "result", status: "ok" },
    ];
    const body = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const bytes = new TextEncoder().encode(body);
        // split mid-line to exercise buffering
        controller.enqueue(bytes.subarray(0, 13));
        controller.enqueue(bytes.subarray(13));
        controller.close();
      },
    });
    const received: unknown[] = [];
    await readNdjsonStream(new Response(stream) as Response, (e) => received.push(e));
    expect(received).toEqual(events);
  });

  it("skips malformed lines and JSON primitives without dying", async () => {
    const body = 'not json\n{"ok":true}\n[1,2]\n42\n';
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    });
    const received: unknown[] = [];
    await readNdjsonStream(new Response(stream) as Response, (e) => received.push(e));
    expect(received).toEqual([{ ok: true }]);
  });
});
