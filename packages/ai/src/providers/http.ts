/**
 * Shared JSON-over-HTTP chat helper for real (online) providers.
 *
 * Mock lives in `./mock.ts` and intentionally never imports from here — the
 * offline demo stays zero-network by construction (AGENTS/ai-integration.md:
 * "mock (default) — works offline, keyword-matched demo plans"). Real
 * providers (openai, ollama) consume this helper so request shaping, timeout,
 * retry, and error truncation stay consistent across HTTP backends. Streaming
 * providers (deepseek) keep their own SSE client — `chatJSON` is intentionally
 * non-streaming.
 *
 * Production semantics (AGENTS/ai-integration.md §"Provider HTTP hardening"):
 * - Non-2xx and network failures surface as {@link ProviderHttpError} with
 *   the status code, a truncated body slice, and a retryable verdict.
 * - Transient failures (429/500/502/503/504, connection errors) are retried
 *   with bounded exponential backoff + jitter, honoring a numeric
 *   `Retry-After` header (capped). Other 4xx and our own timeout aborts are
 *   NOT retried — retrying a timeout would multiply an already-long
 *   wall-clock wait; raise `providers.<name>.timeoutMs` instead.
 * - Error messages keep the historical `HTTP <status>` prefix (test-pinned).
 */

import { theme } from "@tau/ui";

/** Status codes worth a bounded retry (transient server/limit conditions). */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/** Hard cap for any single backoff delay (header-derived or computed). */
const BACKOFF_CAP_MS = 10_000;

/** Base delay for the exponential (non Retry-After) backoff path. */
const BACKOFF_BASE_MS = 1_000;

/** Default retry budget after the first attempt (2 retries → 3 tries max). */
const DEFAULT_RETRIES = 2;

/** Server text rides in error messages — truncate (secret-hygiene rule). */
const ERROR_BODY_SLICE = 300;

/** Typed provider HTTP failure: status-aware, retry-aware, body-truncated. */
export class ProviderHttpError extends Error {
  /** HTTP status code; `undefined` for network-level failures. */
  readonly status: number | undefined;
  /** First ≤300 chars of the response body ("" for network failures). */
  readonly bodySlice: string;
  /** True when the same request may succeed on a later attempt. */
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { status?: number; bodySlice?: string; retryable: boolean },
  ) {
    super(message);
    this.name = "ProviderHttpError";
    this.status = options.status;
    this.bodySlice = options.bodySlice ?? "";
    this.retryable = options.retryable;
  }
}

export interface ChatJSONOptions {
  /** Retry budget after the first attempt (default 2 → 3 tries max). */
  retries?: number;
  /** Injected sleep for tests; defaults to a global-timer promise. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Observability hook (v0.4.0): called with the response's `usage` object
   * when the reply is OK JSON carrying one. Callers normalize via
   * `normalizeUsage` — this layer stays shape-agnostic.
   */
  onUsage?: (usage: unknown) => void;
}

/**
 * Compute the delay before the next retry attempt.
 * Priority: numeric `Retry-After` header (seconds; capped) → exponential
 * `BACKOFF_BASE_MS * 2^attempt` with ±20% jitter → both capped at
 * {@link BACKOFF_CAP_MS}. Exported for tests.
 */
export function computeBackoffMs(retryAfter: string | null, attempt: number): number {
  const seconds = retryAfter === null ? Number.NaN : Number(retryAfter.trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(Math.round(seconds * 1_000), BACKOFF_CAP_MS);
  }
  const raw = BACKOFF_BASE_MS * 2 ** attempt;
  return Math.min(Math.round(raw * (0.8 + Math.random() * 0.4)), BACKOFF_CAP_MS);
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * POST a JSON chat-completions request and return the raw response text.
 * Retries transient failures (429/5xx/network) with bounded exponential
 * backoff — the timeout budget applies PER ATTEMPT, so worst-case wall time
 * is `(retries + 1) × timeoutMs` plus capped backoff. Throws
 * {@link ProviderHttpError} on terminal failure (provider message truncated
 * to ~300 chars, per the secret-hygiene rule that provider errors may carry
 * server text — AGENTS/ai-integration.md §"Secret hygiene").
 */
export async function chatJSON(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs = 60000,
  options: ChatJSONOptions = {},
): Promise<string> {
  const retries = options.retries ?? DEFAULT_RETRIES;
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (res.ok) {
        const text = await res.text();
        if (options.onUsage) {
          try {
            const parsed = JSON.parse(text) as { usage?: unknown };
            if (
              parsed &&
              typeof parsed === "object" &&
              parsed.usage !== null &&
              typeof parsed.usage === "object"
            ) {
              options.onUsage(parsed.usage);
            }
          } catch {
            // Non-JSON reply — no usage to report, the text still returns.
          }
        }
        return text;
      }
      const detail = (await res.text().catch(() => "")).slice(0, ERROR_BODY_SLICE);
      if (RETRYABLE_STATUS.has(res.status) && attempt < retries) {
        // Bounded backoff honoring the server's Retry-After when present.
        await sleep(computeBackoffMs(res.headers.get("retry-after"), attempt));
        continue;
      }
      throw new ProviderHttpError(`${theme.error(`HTTP ${res.status}`)} from provider: ${detail}`, {
        status: res.status,
        bodySlice: detail,
        retryable: RETRYABLE_STATUS.has(res.status),
      });
    } catch (error) {
      if (error instanceof ProviderHttpError) throw error;
      // Network-level failure (connection refused, DNS, ...) — retryable.
      // Our own timeout abort is NOT: the caller should raise timeoutMs.
      const aborted = error instanceof Error && error.name === "AbortError";
      if (!aborted && attempt < retries) {
        await sleep(computeBackoffMs(null, attempt));
        continue;
      }
      throw new ProviderHttpError(
        aborted
          ? `provider request timed out after ${Math.round(timeoutMs / 1000)}s`
          : `provider request failed: ${error instanceof Error ? error.message : String(error)}`,
        { bodySlice: "", retryable: !aborted },
      );
    } finally {
      clearTimeout(timer);
    }
  }
  // Unreachable: every iteration returns, continues, or throws — kept as a
  // type-level safety net for the exhaustive-loop invariant.
  throw new ProviderHttpError("provider request failed: exhausted retries", {
    retryable: false,
  });
}
