/**
 * Shared JSON-over-HTTP chat helper for real (online) providers.
 *
 * Mock lives in `./mock.ts` and intentionally never imports from here — the
 * offline demo stays zero-network by construction (AGENTS/ai-integration.md:
 * "mock (default) — works offline, keyword-matched demo plans"). Real
 * providers (openai, ollama) consume this helper so request shaping, timeout,
 * and error truncation stay consistent across HTTP backends. Streaming
 * providers (deepseek) keep their own SSE client — `chatJSON` is intentionally
 * non-streaming.
 */

import { theme } from "@tau/ui";

/**
 * POST a JSON chat-completions request and return the raw response text.
 * Throws a themed Error on non-2xx (provider message truncated to ~300 chars,
 * per the secret-hygiene rule that provider errors may carry server text —
 * AGENTS/ai-integration.md §"Secret hygiene").
 */
export async function chatJSON(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs = 60000,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      throw new Error(`${theme.error(`HTTP ${res.status}`)} from provider: ${detail}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}
