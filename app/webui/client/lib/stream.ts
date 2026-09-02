/**
 * NDJSON stream consumption for the WebUI — DOM-free so it runs in plain
 * node tests. `POST /api/execute/stream` answers with one JSON event per
 * line; this module turns a fetch `Response` into typed callbacks with a
 * line-buffer that tolerates chunk boundaries anywhere (including inside
 * multi-byte characters, via TextDecoder streaming mode).
 */

export type StreamEvent = Record<string, unknown>;

/**
 * Line-buffering splitter: feed it arbitrary text chunks, it emits complete
 * newline-terminated lines. `flush()` emits a trailing unterminated line
 * (defensive — the server always ends its lines with \n).
 */
export function createNdjsonSplitter(onLine: (line: string) => void): {
  push: (chunk: string) => void;
  flush: () => void;
} {
  let buffer = "";
  return {
    push(chunk: string): void {
      buffer += chunk;
      let index: number;
      while ((index = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, index).replace(/\r$/, "");
        buffer = buffer.slice(index + 1);
        if (line.length > 0) onLine(line);
      }
    },
    flush(): void {
      const rest = buffer.replace(/\r$/, "");
      buffer = "";
      if (rest.length > 0) onLine(rest);
    },
  };
}

/**
 * Consume an NDJSON response body, invoking `onEvent` per parsed JSON line.
 * Malformed lines are skipped (never crash the stream); JSON primitives are
 * ignored (events are objects by contract).
 */
export async function readNdjsonStream(
  response: Response,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  if (!response.body) {
    throw new Error("response has no readable body");
  }
  const decoder = new TextDecoder();
  const splitter = createNdjsonSplitter((line) => {
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        onEvent(parsed as StreamEvent);
      }
    } catch {
      // skip malformed line — the stream stays alive
    }
  });
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      splitter.push(decoder.decode(value, { stream: true }));
    }
    splitter.push(decoder.decode());
    splitter.flush();
  } finally {
    reader.releaseLock();
  }
}

/** POST JSON and consume the NDJSON event stream. Throws on HTTP errors. */
export async function postNdjson(
  path: string,
  payload: unknown,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<Response> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    // Agent-mode Stop: aborting the fetch tears down the connection; the
    // server's res "close" handler cancels the goal runGoal-side.
    signal,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? response.statusText);
  }
  await readNdjsonStream(response, onEvent);
  return response;
}
