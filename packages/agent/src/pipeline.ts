/**
 * Intent -> plan pipeline shared by all Tau UIs (CLI ask, TUI, WebUI).
 * Assembles the full tool catalog (core tools + skill tools + MCP plugin
 * tools), builds the planning context, resolves the provider, and returns the
 * AI's proposed plan. Execution never happens here — every caller must funnel
 * the returned plan through @tau/engine's runPlan, the only execution channel.
 */

import type { Plan, ProviderUsage, SkillMeta } from "@tau/core";
import { normalizeUsage, planningContext, resolveProvider } from "@tau/ai";
import { registerPluginTools } from "@tau/plugins";
import { registerCoreTools, registerTools, resetRegistry } from "@tau/tools";
import { renderSkillCatalog, scanSkills } from "@tau/skills";
import { buildSkillTools } from "./skill-tools.js";

/** Raised when the resolved provider cannot plan in its current state. */
export class ProviderUnavailableError extends Error {
  readonly providerName: string;

  constructor(name: string, reason?: string) {
    super(`Provider "${name}" is not available.${reason ? ` ${reason}` : ""}`);
    this.name = "ProviderUnavailableError";
    this.providerName = name;
  }
}

export interface PlanIntentOptions {
  /** Explicit provider override; falls back to config's provider. */
  provider?: string;
}

export interface PlannedIntent {
  intent: string;
  plan: Plan;
  providerName: string;
  providerLabel: string;
  /** Where the provider choice came from (flag/config/default). */
  providerSource: string;
  /** Degraded-but-alive warnings from MCP plugin loading. */
  warnings: string[];
  /**
   * Token usage of the planning call when the provider reported it
   * (v0.4.0 observability). Absent = provider reports nothing.
   */
  usage?: ProviderUsage;
}

/**
 * Plan a natural-language intent with the full catalog in scope. Plugin tools
 * are registered before planning so an enabled MCP server contributes its
 * tools; its failures degrade to returned warnings, never a crash.
 */
export async function planIntent(
  intent: string,
  options: PlanIntentOptions = {},
): Promise<PlannedIntent> {
  const warnings = await registerPluginTools();
  const scan = scanSkills();
  const ctx = planningContext(intent, renderSkillCatalog(scan.skills));
  const choice = resolveProvider(options.provider);
  const available = await choice.provider.isAvailable();
  if (!available) {
    throw new ProviderUnavailableError(choice.provider.name, choice.provider.unavailableReason?.());
  }
  const plan = await choice.provider.plan(ctx);
  // Observability (issue #98): read the provider's captured usage right
  // after the awaited call (sequential per process — see BaseHttpProvider).
  const usage = normalizeUsage((choice.provider as { lastUsage?: unknown }).lastUsage);
  return {
    intent,
    plan,
    providerName: choice.provider.name,
    providerLabel: choice.provider.label,
    providerSource: choice.source,
    warnings,
    ...(usage ? { usage } : {}),
  };
}

/** Reset + rebuild the registry: core tools, then skill-contributed tools. */
export function prepareCatalog(): void {
  resetRegistry();
  registerCoreTools();
  const scan = scanSkills();
  const skillTools = buildSkillTools(scan.skills);
  if (skillTools.length > 0) registerTools(skillTools);
}

export type { SkillMeta };
