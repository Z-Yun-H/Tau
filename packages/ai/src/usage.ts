/**
 * Usage normalization for the observability baseline (issue #98).
 *
 * Providers report token usage in (at least) two wire shapes:
 * - OpenAI-compatible: `{ usage: { prompt_tokens, completion_tokens, total_tokens } }`
 * - DeepSeek harness mapping: `{ inputTokens, outputTokens, ... }` (cache-adjusted)
 *
 * `normalizeUsage` accepts any of these (numbers only, no invention) and
 * yields the provider-agnostic {@link ProviderUsage} from @tau/core — or
 * undefined when nothing usable is present. `formatUsage` renders the
 * compact `tokens=TOTAL(P/C)` form used by the request log.
 */

import type { ProviderUsage } from "@tau/core";

function asCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Normalize a wire usage object (or an already-normalized one). */
export function normalizeUsage(raw: unknown): ProviderUsage | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const record = raw as Record<string, unknown>;

  // Already normalized (e.g. DeepSeek's mapWireUsage output).
  const promptNorm = asCount(record["promptTokens"]);
  const completionNorm = asCount(record["completionTokens"]);
  if (promptNorm !== undefined && completionNorm !== undefined) {
    const total = asCount(record["totalTokens"]) ?? promptNorm + completionNorm;
    return { promptTokens: promptNorm, completionTokens: completionNorm, totalTokens: total };
  }

  // OpenAI-compatible wire shape.
  const prompt = asCount(record["prompt_tokens"]);
  const completion = asCount(record["completion_tokens"]);
  if (prompt === undefined && completion === undefined) return undefined;
  const total = asCount(record["total_tokens"]) ?? (prompt ?? 0) + (completion ?? 0);
  return {
    promptTokens: prompt ?? 0,
    completionTokens: completion ?? 0,
    totalTokens: total,
  };
}

/** Compact log form: `tokens=123(100/23)`; empty string when absent. */
export function formatUsage(usage: ProviderUsage | undefined): string {
  if (!usage) return "";
  return `tokens=${usage.totalTokens}(${usage.promptTokens}/${usage.completionTokens})`;
}
