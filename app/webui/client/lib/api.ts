/**
 * Typed client for the WebUI HTTP surface. The shapes mirror the server
 * payloads one-to-one (server.ts is the contract; these interfaces are the
 * hand-mirrored read model). Nothing here touches the DOM.
 */

export type RiskLevel = "low" | "medium" | "high" | "blocked";
export type Verdict = "allow" | "review" | "deny";
export type HistoryStatus = "ok" | "failed" | "cancelled" | "denied";

export interface PlanStep {
  kind: "tool" | "shell";
  tool?: string;
  command?: string;
  args?: Record<string, unknown>;
  reason?: string;
}

export interface Plan {
  explanation: string;
  steps: PlanStep[];
}

export interface ReviewIssue {
  level: string;
  message: string;
}

export interface Review {
  verdict: Verdict;
  overallRisk: RiskLevel;
  issues: ReviewIssue[];
}

export interface StatusPayload {
  version: string;
  tauHome: string;
  provider: { name: string; label: string; source: string; model: string };
  providers: { name: string; available: boolean }[];
  skills: number;
  plugins: number;
}

/** One provider entry of the redacted config (all fields display-only). */
export interface RedactedProviderEntry {
  host?: string;
  baseUrl?: string;
  /** Masked ("sk-***last4") — the server never sends plaintext keys. */
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
  availableModels?: unknown;
  modelsRefreshedAt?: string;
  [field: string]: unknown;
}

/**
 * One entry of the server-sent provider catalog (issue #152): the lookup
 * that prefills the endpoint so users never type model API URLs by hand.
 * Mirrors app/webui/src/provider-catalog.ts (the server is the contract).
 */
export interface ProviderCatalogEntry {
  name: string;
  label: string;
  defaultBaseUrl?: string;
  consoleUrl?: string;
  keyless?: boolean;
  note?: string;
}

/** Mirror of the server's `GET /api/config` payload (all of it read-only). */
export interface ConfigPayload {
  version: string;
  tauHome: string;
  /** The effective config exactly as `tau config list` prints it — redacted. */
  config: {
    provider: string;
    timeout: number;
    allowMediumAutoApprove: boolean;
    shell: string;
    aliases: Record<string, string>;
    plugins: string[];
    providers: Record<string, RedactedProviderEntry>;
  };
  provider: { name: string; label: string; source: string; model: string };
  providers: { name: string; available: boolean }[];
  /** Server-sent provider catalog: endpoints + key-console links (setup form). */
  providerCatalog: ProviderCatalogEntry[];
  modelCatalog: { count: number; refreshedAt?: string };
}

export interface SkillSummary {
  name: string;
  description: string;
  commands: number;
  risk: RiskLevel;
  origin: "bundled" | "user" | "workspace";
}

/** One slash-command entry of the shared catalog (server: GET /api/commands). */
export interface CommandInfo {
  name: string;
  aliases?: string[];
  description: string;
  argsHint?: string;
  argsKind?: "none" | "file" | "free";
}

/**
 * One prior conversation turn sent WITH a new request (conversation mode) —
 * the server sanitizes and folds it into the planning context. Mirrors
 * @tau/core's PriorTurn (hand-mirrored like every other payload shape).
 */
export interface TurnInfo {
  role: "user" | "assistant";
  text: string;
}

export interface ToolParamInfo {
  name: string;
  type: "string" | "number" | "boolean" | "string[]";
  description: string;
  required: boolean;
}

export interface ToolSummary {
  name: string;
  description: string;
  risk: RiskLevel;
  owner: string;
  params: ToolParamInfo[];
  /** True when the tool mutates state. Defaults false (read-only) when absent. */
  mutates?: boolean;
  /** True when the tool defaults to a dry-run preview. Defaults false when absent. */
  dryRunDefault?: boolean;
}

export interface HistoryEntry {
  id: string;
  ts: string;
  kind: string;
  input: string;
  steps: PlanStep[];
  status: HistoryStatus;
  exitCode?: number;
  provider?: string;
}

export interface PlanResponse {
  intent: string;
  plan: Plan;
  review: Review;
  provider: string;
  providerLabel: string;
  warnings: string[];
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, options);
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body;
}

export const postJson = <T>(path: string, payload: unknown): Promise<T> =>
  api<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
