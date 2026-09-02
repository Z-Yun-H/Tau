/**
 * chatJSON production-hardening tests — typed ProviderHttpError, bounded
 * retry with backoff (Retry-After honored), non-retryable classes (other
 * 4xx, timeout aborts), and the historical `HTTP <status>` message prefix.
 *
 * AGENTS/testing.md: provider HTTP is tested at the request-shaping level
 * with a stubbed fetch — never a real endpoint.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { chatJSON, computeBackoffMs, ProviderHttpError } from "../src/providers/http.js";

const ORIGINAL_FETCH = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

/** Response factory with a mutable header bag. */
function response(status: number, body = "", headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

/** Instant sleep that records the requested delays. */
function fakeSleep(delays: number[]): (ms: number) => Promise<void> {
  return (ms: number) => {
    delays.push(ms);
    return Promise.resolve();
  };
}

describe("chatJSON retry semantics", () => {
  it("succeeds without retrying on 2xx", async () => {
    const fetchMock = vi.fn(async () => response(200, '{"ok":true}'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const delays: number[] = [];
    const text = await chatJSON("https://x.test/v1/chat", {}, {}, 1000, {
      sleep: fakeSleep(delays),
    });
    expect(text).toBe('{"ok":true}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it("retries 429 then succeeds, honoring the Retry-After delay", async () => {
    const fetchMock = vi.fn(async () => response(429, "rate limited", { "retry-after": "3" }));
    // 429 twice, then success — headers differ per call.
    fetchMock
      .mockImplementationOnce(async () => response(429, "rate limited", { "retry-after": "3" }))
      .mockImplementationOnce(async () => response(429, "rate limited", { "retry-after": "1" }))
      .mockImplementationOnce(async () => response(200, "fine"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const delays: number[] = [];
    const text = await chatJSON("https://x.test/v1/chat", {}, {}, 1000, {
      sleep: fakeSleep(delays),
    });
    expect(text).toBe("fine");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // Retry-After seconds → exact millisecond delay (capped path).
    expect(delays).toEqual([3000, 1000]);
  });

  it("retries 5xx with capped exponential backoff, then throws ProviderHttpError", async () => {
    const fetchMock = vi.fn(async () => response(503, "boom"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const delays: number[] = [];
    const error = await chatJSON("https://x.test/v1/chat", {}, {}, 1000, {
      retries: 2,
      sleep: fakeSleep(delays),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderHttpError);
    expect((error as ProviderHttpError).status).toBe(503);
    expect((error as ProviderHttpError).retryable).toBe(true);
    expect((error as ProviderHttpError).bodySlice).toBe("boom");
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 + 2 retries
    expect(delays.length).toBe(2);
    expect(delays[0]).toBeLessThanOrEqual(10_000);
  });

  it("does NOT retry non-transient 4xx and keeps the HTTP <status> prefix", async () => {
    const fetchMock = vi.fn(async () => response(401, '{"error":"auth failed"}'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const delays: number[] = [];
    const error = await chatJSON("https://x.test/v1/chat", {}, {}, 1000, {
      sleep: fakeSleep(delays),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderHttpError);
    expect((error as ProviderHttpError).message).toContain("HTTP 401");
    expect((error as ProviderHttpError).status).toBe(401);
    expect((error as ProviderHttpError).retryable).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it("does NOT retry its own timeout abort", async () => {
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          });
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const delays: number[] = [];
    const error = await chatJSON("https://x.test/v1/chat", {}, {}, 20, {
      retries: 3,
      sleep: fakeSleep(delays),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderHttpError);
    expect((error as ProviderHttpError).message).toContain("timed out after 0s");
    expect((error as ProviderHttpError).retryable).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it("retries connection-level failures then throws a typed network error", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const delays: number[] = [];
    const error = await chatJSON("https://x.test/v1/chat", {}, {}, 1000, {
      retries: 1,
      sleep: fakeSleep(delays),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderHttpError);
    expect((error as ProviderHttpError).message).toContain("ECONNREFUSED");
    expect((error as ProviderHttpError).status).toBeUndefined();
    expect((error as ProviderHttpError).retryable).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("computeBackoffMs", () => {
  it("uses the Retry-After header verbatim (seconds → ms) and caps it", () => {
    expect(computeBackoffMs("2", 0)).toBe(2000);
    expect(computeBackoffMs("60", 0)).toBe(10_000); // capped
    expect(computeBackoffMs("0", 0)).toBe(0);
  });

  it("falls back to jittered exponential growth without a header", () => {
    for (let i = 0; i < 20; i++) {
      const d = computeBackoffMs(null, 2);
      expect(d).toBeGreaterThanOrEqual(3200); // 4000 × 0.8
      expect(d).toBeLessThanOrEqual(5000); // 4000 × 1.2 — jitter band
    }
    expect(computeBackoffMs(null, 10)).toBe(10_000); // cap
  });

  it("treats non-numeric Retry-After as absent", () => {
    const d = computeBackoffMs("Wed, 02 Sep 2026 00:00:00 GMT", 0);
    expect(d).toBeGreaterThanOrEqual(800);
    expect(d).toBeLessThanOrEqual(1200);
  });
});
