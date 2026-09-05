/**
 * UI session services — the single source of the facts and flows that both
 * interactive front doors (TUI REPL, WebUI server) present and drive:
 * active provider + model, provider availability, skill summaries, recent
 * history, runtime locations, and the shared intent → plan → review step.
 *
 * The UIs only RENDER this data (chalk themes vs JSON); anything that
 * touches the world still goes through @tau/engine's runPlan() at the UI
 * call sites, exactly as before.
 */

import { createRequire } from "node:module";
import { loadConfig, readHistory, setConfigValue, tauHome } from "@tau/core";
import type { HistoryEntry, ProviderStreamHandler, RiskLevel, SafetyReview } from "@tau/core";
import {
  cachedModels,
  describeThinking,
  getProvider,
  getThinkingConfig,
  providerNames,
  refreshProviderModels,
  resolveProvider,
  setThinkingConfig,
  thinkingCapability,
} from "@tau/ai";
import type { ModelCatalog, ThinkingConfig, ThinkingPatch } from "@tau/ai";
import { reviewPlan } from "@tau/engine";
import { scanSkills } from "@tau/skills";
import { allTools } from "@tau/tools";
import {
  planIntent,
  planIntentStream,
  prepareCatalog,
  type PlannedIntent,
  type PlanIntentOptions,
} from "./pipeline.js";

/** The provider a default-less UI should display as active. */
export interface ActiveProviderInfo {
  name: string;
  label: string;
  source: string;
  /** Configured model id, or "(auto)" when the catalog decides at request time. */
  model: string;
}

/** Live availability of one registered provider. */
export interface ProviderAvailability {
  name: string;
  available: boolean;
}

/** Render-ready summary of one discovered skill. */
export interface SkillSummary {
  name: string;
  description: string;
  commands: number;
  risk: RiskLevel;
  origin: "bundled" | "user" | "workspace";
}

/** One tool parameter, shaped for list rendering (no defaults plumbing). */
export interface ToolParamInfo {
  name: string;
  type: "string" | "number" | "boolean" | "string[]";
  description: string;
  required: boolean;
}

/** Render-ready summary of one registered tool — never carries the executable. */
export interface ToolSummary {
  /** Dotted tool name, e.g. "file.find"; skill-owned tools are "git-helper.status" style. */
  name: string;
  description: string;
  risk: RiskLevel;
  /** "core" for built-ins, else the owning skill name. */
  owner: string;
  params: ToolParamInfo[];
  /** True when the tool mutates state (filesystem, file contents, system). Defaults false. */
  mutates: boolean;
  /** True when the tool defaults to a dry-run preview unless execute:true. Defaults false. */
  dryRunDefault: boolean;
}

/** Everything a UI status view needs, in one async snapshot. */
export interface SessionInfo {
  /** Tau version (from the @tau/agent package — all workspace versions move together). */
  version: string;
  tauHome: string;
  provider: ActiveProviderInfo;
  providers: ProviderAvailability[];
  skillsCount: number;
  pluginsCount: number;
}

/** Tau's own version for status surfaces (nearest package.json). */
export function readTauVersion(): string {
  try {
    const requireFromHere = createRequire(import.meta.url);
    return (requireFromHere("../package.json") as { version?: string }).version ?? "0.0.0-dev";
  } catch {
    return "0.0.0-dev";
  }
}

/** Resolve the active provider and its configured model (or "(auto)"). */
export function getActiveProvider(): ActiveProviderInfo {
  const choice = resolveProvider(undefined);
  const providers = loadConfig().providers as Record<string, { model?: string }> | undefined;
  const model = providers?.[choice.provider.name]?.model ?? "(auto)";
  return {
    name: choice.provider.name,
    label: choice.provider.label,
    source: choice.source,
    model,
  };
}

/** Availability of every registered provider (offline-safe: local checks only). */
export async function listProviderAvailability(): Promise<ProviderAvailability[]> {
  return Promise.all(
    providerNames().map(async (name) => {
      const provider = getProvider(name);
      return { name, available: provider ? await provider.isAvailable() : false };
    }),
  );
}

/** Skills discovered across all scopes, shaped for list rendering. */
export function listSkillSummaries(): SkillSummary[] {
  return scanSkills().skills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    commands: skill.commands.length,
    risk: skill.risk,
    origin: skill.origin,
  }));
}

/**
 * Registered tools shaped for list rendering. Builds the tool+skill catalog
 * on demand (idempotent per process), so callers need no bootstrap ordering.
 * The output is pure data — the executable `run` never leaves the registry.
 */
export function listToolSummaries(): ToolSummary[] {
  ensureCatalog();
  return allTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    risk: tool.risk,
    owner: tool.owner,
    params: tool.params.map((param) => ({
      name: param.name,
      type: param.type,
      description: param.description,
      required: param.required,
    })),
    mutates: tool.mutates === true,
    dryRunDefault: tool.dryRunDefault === true,
  }));
}

/** Recent history entries (newest first), shared by both UIs. */
export function readRecentHistory(limit: number): HistoryEntry[] {
  return readHistory(limit);
}

/** ---------------- model & thinking selection (issue #163) ---------------- */

/**
 * Selection services shared by the interactive front doors — the model
 * catalog and thinking knobs are exactly the kind of cross-UI fact that
 * lives here (session.ts is the single source both front doors read);
 * wrapping @tau/ai keeps TUI/WebUI free of new dependency edges.
 */

/**
 * Model catalog for one provider (default: the active one).
 * - offline → the cached catalog only, zero network;
 * - otherwise the catalog service's own precedence (fresh cache → live
 *   fetch → cached + warning), so callers render ONE shape for all paths.
 * Unknown providers throw with the registered names.
 */
export async function listModelCatalog(
  provider?: string,
  options: { refresh?: boolean; offline?: boolean } = {},
): Promise<ModelCatalog> {
  const name = provider ?? getActiveProvider().name;
  if (!getProvider(name)) {
    throw new Error(`Unknown provider "${name}". Registered: ${providerNames().join(", ")}`);
  }
  if (options.offline) {
    const cache = cachedModels(name);
    return {
      provider: name,
      models: cache.models,
      source: "cache",
      ...(cache.refreshedAt ? { refreshedAt: cache.refreshedAt } : {}),
    };
  }
  return refreshProviderModels(name, { force: options.refresh === true });
}

/** Persist the model choice for one provider (the `tau provider use` channel). */
export function setProviderModel(provider: string, model: string): void {
  if (!getProvider(provider)) {
    throw new Error(`Unknown provider "${provider}". Registered: ${providerNames().join(", ")}`);
  }
  const trimmed = model.trim();
  if (!trimmed) throw new Error("model id must not be empty");
  setConfigValue(`providers.${provider}.model`, trimmed);
}

/** Normalized thinking state + capability of one provider (default: active). */
export interface ThinkingState {
  provider: string;
  capability: ReturnType<typeof thinkingCapability>;
  config: ThinkingConfig;
  /** One-line human summary of the config (e.g. "on (high)", "off"). */
  summary: string;
}

export function thinkingState(provider?: string): ThinkingState {
  const name = provider ?? getActiveProvider().name;
  if (!getProvider(name)) {
    throw new Error(`Unknown provider "${name}". Registered: ${providerNames().join(", ")}`);
  }
  return {
    provider: name,
    capability: thinkingCapability(name),
    config: getThinkingConfig(name),
    summary: describeThinking(name),
  };
}

/** Validated thinking write (capability refusals bubble up as actionable errors). */
export function updateThinking(provider: string, patch: ThinkingPatch): ThinkingState {
  if (!getProvider(provider)) {
    throw new Error(`Unknown provider "${provider}". Registered: ${providerNames().join(", ")}`);
  }
  setThinkingConfig(provider, patch);
  return thinkingState(provider);
}

/** One async snapshot of the facts both UIs show on their status surface. */
export async function getSessionInfo(): Promise<SessionInfo> {
  const provider = getActiveProvider();
  const providers = await listProviderAvailability();
  const config = loadConfig();
  return {
    version: readTauVersion(),
    tauHome: tauHome(),
    provider,
    providers,
    skillsCount: scanSkills().skills.length,
    pluginsCount: (config.plugins ?? []).length,
  };
}

let catalogReady = false;

/** Build the tool+skill catalog once per process (no-op afterwards). */
export function ensureCatalog(): void {
  if (!catalogReady) {
    prepareCatalog();
    catalogReady = true;
  }
}

export interface PlannedWithReview extends PlannedIntent {
  /** Deterministic review of the planned plan (same verdict runPlan will re-derive). */
  review: SafetyReview;
}

/**
 * Plan an intent and review it — the shared front half of the intent
 * pipeline. Callers render the plan/review, gate on `review.verdict`, then
 * execute through runPlan() (the only execution channel).
 */
export async function planAndReview(
  intent: string,
  options: PlanIntentOptions = {},
): Promise<PlannedWithReview> {
  const planned = await planIntent(intent, options);
  return { ...planned, review: reviewPlan(planned.plan) };
}

/**
 * Streaming twin of planAndReview (v0.5.0): same catalog, same provider
 * resolution, same deterministic review — provider stream events (thinking
 * / text / usage) relay to onEvent while the plan generates. Falls back to
 * the buffered plan() when the provider has no planStream capability.
 */
export async function planAndReviewStream(
  intent: string,
  options: PlanIntentOptions = {},
  onEvent?: ProviderStreamHandler,
): Promise<PlannedWithReview> {
  const planned = await planIntentStream(intent, options, onEvent);
  return { ...planned, review: reviewPlan(planned.plan) };
}
