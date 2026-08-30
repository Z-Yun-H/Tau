import type { ToolDefinition, ToolResult } from "../types.js";

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
  return allTools()
    .map((tool) => {
      const params = tool.params
        .map((p) => `${p.name}${p.required ? "" : "?"}:${p.type}${p.required ? "" : "=opt"}`)
        .join(", ");
      return `- ${tool.name} [risk:${tool.risk}] ${tool.description}\n  params: (${params || "none"})`;
    })
    .join("\n");
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
