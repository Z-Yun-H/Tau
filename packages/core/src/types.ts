/**
 * Tau core domain types.
 *
 * These types are the shared vocabulary of the whole project:
 * CLI, tools, AI planner, safety reviewer and skills all speak this language.
 * When you change something here, run `npm run typecheck` and update
 * AGENTS/architecture.md if the data flow changes.
 */

/** Risk classification used by the safety reviewer and every tool definition. */
export type RiskLevel = "low" | "medium" | "high" | "blocked";

export const RISK_ORDER: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  blocked: 3,
};

/** A single action inside an AI-generated or replayed plan. */
export interface PlanStep {
  /**
   * Either a registered tool name (e.g. "file.find") or "shell" for a
   * raw shell command. Tool steps are preferred; shell steps are always
   * subject to stricter review.
   */
  kind: "tool" | "shell";
  /** Tool name ("file.find") when kind === "tool". */
  tool?: string;
  /** Raw shell command when kind === "shell". */
  command?: string;
  /** Structured arguments for tool steps. */
  args?: Record<string, unknown>;
  /** Human readable explanation of why this step exists. */
  reason: string;
}

/** A plan produced by an AI provider (or mock) for a natural language intent. */
export interface Plan {
  /** Short summary of what the plan does. */
  explanation: string;
  steps: PlanStep[];
  /** Provider's own opinion of the risk, reviewer has the final say. */
  selfAssessedRisk?: RiskLevel;
}

/**
 * Lifecycle event emitted by runPlan while a plan moves through execution.
 * Backends without UI (CLI) ignore them; front doors (WebUI streaming) mirror
 * them to the client so progress renders live. Absent callback = zero
 * behavior change.
 */
export type PlanEvent =
  /** A step is about to execute (after its per-step gate). */
  | { type: "step_start"; index: number; step: PlanStep }
  /** Incremental output from a shell step's stdout/stderr (chunked). */
  | { type: "step_output"; index: number; chunk: string }
  /** A step finished; `skipped` marks gate-refused steps. */
  | { type: "step_end"; index: number; ok: boolean; exitCode?: number; skipped?: boolean }
  /** Terminal event — always emitted last, exactly once. */
  | { type: "plan_end"; status: "ok" | "failed" | "cancelled" | "denied" };

/** Structured issue raised while reviewing a plan or step. */
export interface SafetyIssue {
  level: RiskLevel;
  message: string;
  /** Which step index raised this (absent for plan-level issues). */
  stepIndex?: number;
}

/** Result of reviewing a whole plan. */
export interface SafetyReview {
  verdict: "allow" | "review" | "deny";
  overallRisk: RiskLevel;
  issues: SafetyIssue[];
}

/** JSON-schema-ish description of a tool's parameters (kept simple, zod-backed). */
export interface ToolParamSpec {
  name: string;
  type: "string" | "number" | "boolean" | "string[]";
  description: string;
  required: boolean;
  default?: unknown;
}

/**
 * A built-in or skill-provided tool. Tools are dual-use:
 * - bound to CLI subcommands (humans call them directly)
 * - exposed to the AI planner as a catalog (AI calls them safely)
 */
export interface ToolDefinition {
  /** Dotted name, e.g. "file.find", "git-helper.status". */
  name: string;
  /** One-line description shown to both humans and the AI planner. */
  description: string;
  params: ToolParamSpec[];
  /** Intrinsic risk of running this tool with any arguments. */
  risk: RiskLevel;
  /** Module that owns this tool ("core" for built-ins, skill name otherwise). */
  owner: string;
  run: (args: Record<string, unknown>) => Promise<ToolResult>;
}

export interface ToolResult {
  /** Human-readable output (already plain text, no ANSI). */
  text: string;
  /** Optional structured payload for tests and AI consumption. */
  data?: unknown;
}

/** ---------- Skills ---------- */

/** Command exposed by a skill (declarative, low-risk by design). */
export interface SkillCommand {
  name: string;
  description: string;
  /** Shell command template; {args} placeholders are filled positionally. */
  command: string;
  risk?: RiskLevel;
}

/** Parsed frontmatter of a SKILL.md file. */
export interface SkillMeta {
  name: string;
  version: string;
  description: string;
  author?: string;
  tags: string[];
  /** Highest intrinsic risk among the skill's commands. */
  risk: RiskLevel;
  /** Keywords that make the skill discoverable by the offline matcher / AI. */
  triggers: string[];
  commands: SkillCommand[];
  /** Absolute path of the SKILL.md file. */
  sourcePath: string;
  /** Directory containing the SKILL.md file. */
  dir: string;
  /** Where this skill was discovered from. */
  origin: "bundled" | "user" | "workspace";
}

/** Validation problem found in a SKILL.md file. */
export interface SkillIssue {
  path: string;
  message: string;
}

/** ---------- AI providers ---------- */

/** One model offered by a provider's discovery endpoint (GET /models, /api/tags, ...). */
export interface ModelInfo {
  /** Model id exactly as the API expects it, e.g. "deepseek-chat". */
  id: string;
  /** Optional owner/creator label from the API (e.g. "deepseek", "openai"). */
  ownedBy?: string;
}

/** Context handed to a provider so it can plan against the real tool catalog. */
export interface PlanningContext {
  intent: string;
  toolCatalog: string;
  skillCatalog: string;
  platform: string;
  cwd: string;
}

/** Provider interface. Implement this to add a new AI backend. */
export interface AIProvider {
  /** Registry key, e.g. "mock" | "ollama" | "openai" | "deepseek" | "zai". */
  readonly name: string;
  /** Human-readable label used in CLI output. */
  readonly label: string;
  /** True when the provider has what it needs (key, host, sdk...) to run. */
  isAvailable(): Promise<boolean>;
  /** Where the missing configuration is, when isAvailable() is false. */
  unavailableReason?(): string;
  /** Turn a natural-language intent into a validated Plan. */
  plan(ctx: PlanningContext): Promise<Plan>;
  /**
   * Optional live model discovery (GET /models or equivalent). Providers
   * without a discovery endpoint omit this; `tau provider` then reports the
   * catalog as unsupported instead of pretending. Implementations must throw
   * on auth/network failures — the caller owns caching and degradation.
   */
  listModels?(): Promise<ModelInfo[]>;
}

/** ---------- History ---------- */

export type HistoryKind = "direct" | "plan";

export interface HistoryEntry {
  id: string;
  ts: string;
  kind: HistoryKind;
  /** Original user input: CLI argv or natural language intent. */
  input: string;
  steps: PlanStep[];
  status: "ok" | "failed" | "cancelled" | "denied";
  exitCode?: number;
  /** Provider that generated the plan, when applicable. */
  provider?: string;
}

/** ---------- Plugins (MCP servers) ---------- */

/**
 * One configured MCP (Model Context Protocol) server. Plugins are the
 * escape hatch that lets Tau drive external tools (dsh, VS Code, GitHub,
 * filesystems, ...) through the same plan -> review -> confirm pipeline as
 * built-in tools. See docs/plugins.md and AGENTS/plugins.md.
 */
export interface PluginConfig {
  /** Local alias; tool names become "plugin.<name>.<tool>". kebab-case. */
  name: string;
  /** stdio spawns a local server command; http connects to a Streamable HTTP endpoint. */
  transport: "stdio" | "http";
  /** stdio transport: executable to spawn (resolved via PATH). */
  command?: string;
  /** stdio transport: argument list. */
  args?: string[];
  /** stdio transport: extra environment variables layered over process.env. */
  env?: Record<string, string>;
  /** stdio transport: working directory (default: current directory). */
  cwd?: string;
  /** http transport: endpoint URL speaking MCP Streamable HTTP. */
  url?: string;
  /** http transport: static request headers (e.g. auth tokens). */
  headers?: Record<string, string>;
  /** Disabled plugins stay configured but are never connected (default true). */
  enabled?: boolean;
  /** Human description shown by `tau plugin list`. */
  description?: string;
}

/** ---------- Aliases & config ---------- */

export interface TauConfig {
  provider: string;
  /** Timeout in seconds for executed commands. */
  timeout: number;
  /** When true, `--yes` may auto-approve medium risk too (never high/blocked). */
  allowMediumAutoApprove: boolean;
  aliases: Record<string, string[]>;
  /** MCP servers whose tools join the AI planner catalog. */
  plugins: PluginConfig[];
  /** Provider-specific settings (model names, hosts...). */
  providers: Record<string, Record<string, unknown>>;
}

export interface ProviderChoice {
  provider: AIProvider;
  source: "flag" | "env" | "config" | "default";
}
