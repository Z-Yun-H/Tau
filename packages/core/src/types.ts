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

/**
 * Shell used for plan shell-steps. `auto` keeps platform defaults (POSIX
 * unchanged; Windows prefers PowerShell when detectable, else COMSPEC).
 * `pwsh`/`powershell` force an explicit non-profile non-interactive invocation
 * with exit-code propagation — cross-platform (pwsh runs on Linux/macOS too).
 */
export type ShellPref = "auto" | "bash" | "pwsh" | "powershell";

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
  /**
   * True when the tool mutates the filesystem, file contents, or system state.
   * Defaults to `false` (read-only) when absent — the planner prompt and the
   * UI both surface this so read-only tools can be preferred first.
   * AGENTS/ai-integration.md "prefer DRY-RUN modes" rule.
   */
  mutates?: boolean;
  /**
   * True when the tool defaults to a dry-run (preview) mode unless explicitly
   * told to execute (e.g. `file.rename`, `text.replace` with `execute:false`).
   * Surfaced in the prompt so the planner knows it can safely propose the
   * dry-run first. Defaults to `false` when absent.
   */
  dryRunDefault?: boolean;
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

/**
 * One prior conversation turn presented to the provider for context
 * (conversation mode, issue #134). UIs send the last N turns of the active
 * thread; the prompt layer folds them into the planning intent.
 */
export interface PriorTurn {
  role: "user" | "assistant";
  text: string;
}

/**
 * One image attached to a planning request (image parsing module, issue
 * #135). Payload-only data: raw base64 (no `data:` URL prefix) plus the
 * IANA media type the SENDER claims — front doors must whitelist the type
 * AND verify the magic number before the attachment reaches a provider.
 * Vision-capable providers map it into their wire shape (OpenAI image_url,
 * Anthropic image source block, Gemini inline_data, Ollama images field);
 * text-only providers see a text annotation and the image is honestly
 * reported as dropped.
 */
export interface ImageAttachment {
  kind: "image";
  /** Original file name when the front door knows one (display-only). */
  name?: string;
  /** Claimed media type, e.g. "image/png". Whitelisted by front doors. */
  mediaType: string;
  /** Raw base64 payload (no data: prefix, no padding games). */
  dataBase64: string;
}

/** Context handed to a provider so it can plan against the real tool catalog. */
export interface PlanningContext {
  intent: string;
  toolCatalog: string;
  skillCatalog: string;
  platform: string;
  cwd: string;
  /**
   * Images attached to this request (issue #135), in the order the user
   * attached them. Absent/empty = a plain text request — providers then
   * behave byte-identically to before. The prompt layer folds a text
   * annotation per image into `intent`; vision-capable providers ALSO map
   * the payload into their wire shape from this field.
   */
  attachments?: ImageAttachment[];
}

/** Provider interface. Implement this to add a new AI backend. */
export interface AIProvider {
  /** Registry key, e.g. "mock" | "ollama" | "openai" | "deepseek" | "zai" | "anthropic" | "gemini". */
  readonly name: string;
  /** Human-readable label used in CLI output. */
  readonly label: string;
  /**
   * True when the provider maps {@link PlanningContext.attachments} into its
   * wire shape (image parsing module, issue #135). Optional and absent by
   * default — a provider that omits it is treated as text-only and the
   * prompt layer annotates attached images as dropped (honest degradation).
   * Set so far by: openai, anthropic, gemini, ollama.
   */
  readonly supportsVision?: boolean;
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
  /**
   * Optional multi-round reflection: after one or more executed rounds the
   * provider decides whether the goal is DONE (with a final answer) or a
   * NEXT plan should run. Absent = the provider is single-round; the agent
   * loop then degrades to one executed round and reports honestly instead
   * of pretending loop capability. Implemented so far by: mock, openai.
   * The returned plan (if any) is ALWAYS re-reviewed by the deterministic
   * safety reviewer before it can touch the world — the AI never grades
   * itself.
   */
  reflect?(ctx: ReflectContext): Promise<AgentDecision>;
  /**
   * Optional streaming variant of {@link plan} (v0.5.0): emits
   * {@link ProviderStreamEvent}s as the reply is generated (reasoning/text
   * deltas, usage) and resolves to the SAME zod-validated Plan the
   * non-streaming plan() produces — streaming never weakens the plan
   * contract (validatePlanResponse runs on the assembled text). Absent =
   * front doors fall back to plan() with zero behavior change.
   * Implemented by: mock, openai, deepseek, ollama, anthropic, gemini;
   * zai degrades to a single-shot emission (SDK is non-streaming).
   */
  planStream?(ctx: PlanningContext, onEvent?: ProviderStreamHandler): Promise<Plan>;
  /**
   * Optional streaming twin of {@link reflect} (v0.5.0): same contract and
   * the same validated {@link AgentDecision}, with reasoning/text deltas
   * relayed through the observer while the reflection turn generates.
   * Absent = the agent loop calls the buffered reflect() (zero behavior
   * change). Implemented by: mock, openai, anthropic, gemini; providers
   * without reflect() at all omit both.
   */
  reflectStream?(ctx: ReflectContext, onEvent?: ProviderStreamHandler): Promise<AgentDecision>;
}

/** ---------- Provider streaming (v0.5.0) ---------- */

/**
 * One incremental event from a provider's generative turn (v0.5.0 streaming
 * planning). Provider-agnostic by construction — every wire shape (OpenAI
 * SSE, Anthropic Messages SSE, Gemini streamGenerateContent, Ollama NDJSON)
 * folds into these three event kinds:
 * - `reasoning_delta`: a chunk of the model's thinking trace (DeepSeek
 *   `reasoning_content`, Anthropic `thinking_delta`, Gemini `thought`
 *   parts, Ollama `thinking`) — never part of the plan text itself.
 * - `text_delta`: a chunk of the user-visible reply text (for Tau that is
 *   the strict-JSON plan document).
 * - `usage`: normalized token usage for the call (same shape as
 *   {@link ProviderUsage}; best-effort, absent when the wire reports none).
 */
export type ProviderStreamEvent =
  | { type: "reasoning_delta"; text: string }
  | { type: "text_delta"; text: string }
  | { type: "usage"; usage: ProviderUsage };

/** Observer of a provider's streaming turn (front doors relay these verbatim). */
export type ProviderStreamHandler = (event: ProviderStreamEvent) => void;

/** ---------- Agent loop (multi-round reflection) ---------- */

/** Record of one executed round, fed back to the provider for reflection. */
export interface RoundFeedback {
  /** 1-based round index within the goal. */
  round: number;
  /** The plan that executed this round (exactly what ran through runPlan). */
  plan: Plan;
  /** Terminal status of the round's runPlan invocation. */
  status: "ok" | "failed" | "cancelled" | "denied";
  /** Per-step outputs (loop-truncated before reaching the provider). */
  outputs: string[];
}

/** Everything the provider needs to reflect on executed rounds. */
export interface ReflectContext {
  intent: string;
  toolCatalog: string;
  skillCatalog: string;
  platform: string;
  cwd: string;
  /** Executed rounds so far, in order (round 1 first). */
  rounds: RoundFeedback[];
}

/**
 * The provider's post-round decision — a discriminated union:
 * - `{ done: true, answer }`: the goal is complete; `answer` is the final
 *   user-facing response (already-executed work stays as-is).
 * - `{ done: false, plan, note? }`: one more round should run; the plan is
 *   proposed, never trusted — the deterministic reviewer re-grades it and
 *   runPlan remains the only execution channel.
 */
export type AgentDecision =
  | { done: true; answer: string }
  | { done: false; plan: Plan; note?: string };

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

/** ---------- Observability (v0.4.0) ---------- */

/**
 * Provider token usage for one AI call, normalized across wire shapes
 * (OpenAI `prompt_tokens`/`completion_tokens`, DeepSeek's cache-adjusted
 * mapping). All fields are best-effort: a provider that reports nothing
 * leaves the whole field absent — usage is never invented.
 */
export interface ProviderUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** ---------- Aliases & config ---------- */
export interface TauConfig {
  provider: string;
  /** Timeout in seconds for executed commands. */
  timeout: number;
  /** When true, `--yes` may auto-approve medium risk too (never high/blocked). */
  allowMediumAutoApprove: boolean;
  /** Shell for plan shell-steps (default "auto" — see {@link ShellPref}). */
  shell?: ShellPref;
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
