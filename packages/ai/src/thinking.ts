/**
 * Unified thinking configuration — the normalized "thinking mode" and
 * "thinking effort" layer behind `tau provider thinking` and the TUI/WebUI
 * selection components (issue #162).
 *
 * Problem it solves: thinking knobs were per-provider private config keys
 * (`think` for ollama, `thinking` + `thinkingBudget` for anthropic,
 * `thinkingBudget` for gemini) with no shared vocabulary — every front door
 * would have to hardcode each provider's field names and semantics. This
 * module owns the ONE capability table and the ONE normalized read/write
 * path; providers map the normalized config onto their wire shapes and UIs
 * render straight from `thinkingCapability()`.
 *
 * Config keys (per provider entry, all optional, all opt-in — an entry with
 * none of them makes every provider request byte-identical to before):
 * - `providers.<name>.thinking`: "on" | "off"  (legacy booleans read as on/off)
 * - `providers.<name>.thinkingEffort`: "low" | "medium" | "high"
 * - `providers.<name>.thinkingBudget`: number   (explicit budget wins over
 *   the effort presets on budget-capable providers)
 *
 * Legacy keys keep working on read: `thinking: true/false` and ollama's
 * `think: true` map onto the normalized mode; nothing is migrated or
 * rewritten behind the user's back.
 */

import { loadConfig, updateProviderEntry } from "@tau/core";

/** Normalized thinking mode. Absent = provider default (typically off). */
export type ThinkingMode = "on" | "off";

/** Normalized thinking intensity (思考强度). */
export type ThinkingEffort = "low" | "medium" | "high";

export const THINKING_EFFORTS: readonly ThinkingEffort[] = ["low", "medium", "high"];

/** What thinking knobs a provider exposes — the table every UI renders from. */
export interface ThinkingCapability {
  /** Provider accepts a thinking on/off toggle on the wire. */
  mode: boolean;
  /** Provider accepts a low/medium/high intensity. */
  effort: boolean;
  /** Provider accepts an explicit token budget (overrides effort presets). */
  budget: boolean;
}

/**
 * The single capability table. Wire mapping per provider:
 * - anthropic: mode on → `thinking: {type: "enabled", budget_tokens}` where
 *   the budget is the explicit `thinkingBudget`, else the effort preset,
 *   else the provider default (4096).
 * - gemini: mode off → `thinkingConfig: {thinkingBudget: 0}` (explicitly
 *   disabled); on → explicit budget, else effort preset, else -1 (dynamic);
 *   a bare `thinkingBudget` keeps its legacy standalone behavior.
 * - openai: effort → `reasoning_effort` (sent only when explicitly set —
 *   OpenAI-shaped endpoints that ignore the field are never bothered).
 * - deepseek: mode → `thinking: {type: "enabled" | "disabled"}` (sent only
 *   when explicitly set).
 * - ollama: mode → `think: true/false` (legacy `think: true` still works).
 * - mock/zai: no thinking knobs.
 */
const CAPABILITIES: Record<string, ThinkingCapability> = {
  anthropic: { mode: true, effort: true, budget: true },
  gemini: { mode: true, effort: true, budget: true },
  openai: { mode: false, effort: true, budget: false },
  deepseek: { mode: true, effort: false, budget: false },
  ollama: { mode: true, effort: false, budget: false },
  mock: { mode: false, effort: false, budget: false },
  zai: { mode: false, effort: false, budget: false },
};

const NO_KNOBS: ThinkingCapability = { mode: false, effort: false, budget: false };

/** Capability of one provider (unknown/unregistered names report no knobs). */
export function thinkingCapability(name: string): ThinkingCapability {
  return CAPABILITIES[name] ?? NO_KNOBS;
}

/** Effort → token-budget presets for budget-capable providers. */
export const EFFORT_BUDGETS: Record<ThinkingEffort, number> = {
  low: 2048,
  medium: 8192,
  high: 16384,
};

/** Normalized thinking state of one provider (absent fields = not set). */
export interface ThinkingConfig {
  mode?: ThinkingMode;
  effort?: ThinkingEffort;
  /** Explicit token budget (budget-capable providers); wins over presets. */
  budget?: number;
}

/** Normalized read: legacy booleans fold into the mode; junk is ignored. */
export function getThinkingConfig(name: string): ThinkingConfig {
  const entry = loadConfig().providers[name] ?? {};

  let mode: ThinkingMode | undefined;
  const rawMode = entry["thinking"];
  if (rawMode === "on" || rawMode === true) mode = "on";
  else if (rawMode === "off" || rawMode === false) mode = "off";
  // ollama legacy key: `think: true` meant the same thing as thinking: "on".
  if (mode === undefined && name === "ollama" && entry["think"] === true) mode = "on";

  const rawEffort = entry["thinkingEffort"];
  const effort = THINKING_EFFORTS.find((value) => value === rawEffort);

  const rawBudget = Number(entry["thinkingBudget"]);
  const budget = Number.isFinite(rawBudget) && rawBudget > 0 ? Math.trunc(rawBudget) : undefined;

  return {
    ...(mode !== undefined ? { mode } : {}),
    ...(effort !== undefined ? { effort } : {}),
    ...(budget !== undefined ? { budget } : {}),
  };
}

/** True when any thinking knob is configured for the provider. */
export function hasThinkingConfig(name: string): boolean {
  const config = getThinkingConfig(name);
  return config.mode !== undefined || config.effort !== undefined || config.budget !== undefined;
}

/** One-line human summary, e.g. `on (high)` / `off` / `provider default`. */
export function describeThinking(name: string): string {
  const config = getThinkingConfig(name);
  if (config.mode === "on") {
    const intensity = config.budget !== undefined ? `${config.budget} tokens` : config.effort;
    return intensity ? `on (${intensity})` : "on";
  }
  if (config.mode === "off") return "off";
  if (config.effort !== undefined) return `effort ${config.effort}`;
  if (config.budget !== undefined) return `budget ${config.budget} tokens`;
  return "provider default";
}

export interface ThinkingPatch {
  /** "on"/"off" to set, null to clear (back to the provider default). */
  mode?: ThinkingMode | null;
  /** "low"/"medium"/"high" to set, null to clear. */
  effort?: ThinkingEffort | null;
  /** Explicit token budget to set, null to clear. */
  budget?: number | null;
}

/**
 * Validated write. Knobs outside the provider's capability matrix are
 * REFUSED with an actionable message (never silently stored-and-ignored —
 * the UIs surface the same capability table, so this only triggers on raw
 * config edits). Clearing (null) is always allowed: removing a key is safe
 * even when the provider has no such knob.
 */
export function setThinkingConfig(name: string, patch: ThinkingPatch): ThinkingConfig {
  const capability = thinkingCapability(name);
  const update: Record<string, unknown> = {};

  if (patch.mode !== undefined) {
    if (patch.mode !== null && !capability.mode) {
      throw new Error(
        `provider "${name}" does not support a thinking mode toggle ` +
          `(supported knobs: ${supportedKnobs(capability)})`,
      );
    }
    // undefined (not null) on clear: JSON.stringify drops undefined keys,
    // so the entry really shrinks instead of accumulating null junk.
    update["thinking"] = patch.mode ?? undefined;
  }
  if (patch.effort !== undefined) {
    if (patch.effort !== null) {
      if (!capability.effort) {
        throw new Error(
          `provider "${name}" does not support a thinking effort level ` +
            `(supported knobs: ${supportedKnobs(capability)})`,
        );
      }
      if (!THINKING_EFFORTS.includes(patch.effort)) {
        throw new Error(`invalid thinking effort "${String(patch.effort)}" — use low|medium|high`);
      }
    }
    update["thinkingEffort"] = patch.effort ?? undefined;
  }
  if (patch.budget !== undefined) {
    if (patch.budget !== null) {
      if (!capability.budget) {
        throw new Error(
          `provider "${name}" does not support an explicit thinking budget ` +
            `(supported knobs: ${supportedKnobs(capability)})`,
        );
      }
      if (!Number.isFinite(patch.budget) || patch.budget <= 0) {
        throw new Error("thinking budget must be a positive number of tokens");
      }
      update["thinkingBudget"] = Math.trunc(patch.budget);
    } else {
      update["thinkingBudget"] = undefined; // clears the key on merge
    }
  }

  if (Object.keys(update).length > 0) {
    updateProviderEntry(name, update);
  }
  return getThinkingConfig(name);
}

/** "mode, effort" style list of what a provider DOES support. */
function supportedKnobs(capability: ThinkingCapability): string {
  const knobs: string[] = [];
  if (capability.mode) knobs.push("mode");
  if (capability.effort) knobs.push("effort");
  if (capability.budget) knobs.push("budget");
  return knobs.length > 0 ? knobs.join(", ") : "none";
}
