/**
 * Central tool registry — idempotent ToolDefinition registration with
 * replace support (tests), lookup by id, catalog rendering for the AI prompt,
 * and the shared argument-coercion helpers (strArg/numArg/boolArg).
 */

import type { ToolDefinition, ToolResult } from "@tau/core";

/**
 * Central tool registry.
 *
 * Built-in tools are registered below; skill tools are appended at runtime by
 * the skills loader. The registry is the single source of truth for:
 * - CLI subcommand dispatch (tau file find -> file.find)
 * - The AI planner catalog (name/description/params/risk rendered as text)
 */
const registry = new Map<string, ToolDefinition>();

/**
 * Register tools. Duplicate names throw — EXCEPT when `replace: true`
 * (used by core tools so repeated registration, e.g. in tests or repeated
 * buildProgram() calls, is idempotent instead of fatal).
 */
export function registerTools(tools: ToolDefinition[], options: { replace?: boolean } = {}): void {
  for (const tool of tools) {
    if (registry.has(tool.name) && !options.replace) {
      throw new Error(`Duplicate tool name: ${tool.name}`);
    }
    registry.set(tool.name, tool);
  }
}

export function getTool(name: string): ToolDefinition | undefined {
  return registry.get(name);
}

export function allTools(): ToolDefinition[] {
  return [...registry.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function resetRegistry(): void {
  registry.clear();
}

/** Render the registry as compact text for the AI planner prompt. */
export function renderToolCatalog(): string {
  const tools = allTools();
  if (tools.length === 0) return "(no tools registered)";

  // Group by family (dotted prefix) so the planner can scope its attention.
  // Skill-owned tools (e.g. "git-helper.status") cluster under their skill
  // name; core tools cluster under "file" / "sys" / "net" / "text".
  const groups = new Map<string, ToolDefinition[]>();
  for (const tool of tools) {
    const dot = tool.name.indexOf(".");
    const family = dot === -1 ? "other" : tool.name.slice(0, dot);
    const arr = groups.get(family);
    if (arr) arr.push(tool);
    else groups.set(family, [tool]);
  }

  const blocks: string[] = [];
  for (const [family, familyTools] of groups) {
    blocks.push(`## ${family} (${familyTools.length})`);
    for (const tool of familyTools) {
      const params = tool.params
        .map((p) => `${p.name}${p.required ? "" : "?"}:${p.type}${p.required ? "" : "=opt"}`)
        .join(", ");
      // Mutation/dry-run tags help the planner prefer read-only + dry-run
      // first (AGENTS/ai-integration.md "prefer DRY-RUN modes" rule).
      const tags: string[] = [`risk:${tool.risk}`];
      if (tool.mutates) tags.push("mutates");
      if (tool.dryRunDefault) tags.push("dry-run-default");
      blocks.push(
        `- ${tool.name} [${tags.join(", ")}] ${tool.description}\n  params: (${params || "none"})`,
      );
    }
  }
  return blocks.join("\n");
}

/**
 * One-line catalog summary for the system prompt: tool/family counts + a
 * read/mut split so the planner knows the catalog shape at a glance.
 */
export function catalogSummary(): string {
  const tools = allTools();
  if (tools.length === 0) return "0 tools";
  const families = new Set<string>();
  let mut = 0;
  let reads = 0;
  for (const tool of tools) {
    const dot = tool.name.indexOf(".");
    if (dot !== -1) families.add(tool.name.slice(0, dot));
    if (tool.mutates) mut++;
    else reads++;
  }
  return `${tools.length} tools across ${families.size} families (${reads} read / ${mut} mutates)`;
}

/** Extract a string param with type coercion and defaults. */
export function strArg(
  args: Record<string, unknown>,
  key: string,
  fallback?: string,
): string | undefined {
  const value = args[key];
  if (typeof value === "string" && value.length > 0) return value;
  return fallback;
}

export function numArg(
  args: Record<string, unknown>,
  key: string,
  fallback?: number,
): number | undefined {
  const value = args[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return fallback;
}

export function boolArg(args: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = args[key];
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

export function textResult(text: string, data?: unknown): ToolResult {
  return { text, data };
}
