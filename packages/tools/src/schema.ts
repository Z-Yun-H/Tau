/**
 * Function-calling schema export — renders the registry as OpenAI-compatible
 * `tools` entries (chat-completions `tools: [...]` / function-calling wire
 * format, per the OpenAI + DeepSeek function-calling API docs) so any
 * OpenAI-compatible planning backend can bind Tau's tools natively instead
 * of parsing the text catalog (`renderToolCatalog`).
 *
 * Pure object construction — `@tau/tools` deliberately has no zod dependency
 * (runtime deps are frozen; see AGENTS.md golden rule 4).
 *
 * Naming: the OpenAI-compatible function-name grammar allows only
 * `[a-zA-Z0-9_-]` (≤64 chars) — dots are invalid. Tau's dotted tool names
 * (`file.find`) are mapped to `file__find` (dot → double underscore) by
 * `functionNameFor()`; the mapping is reversible via `toolNameFor()` and
 * `functionTools()` fails fast on collisions or >64-char names instead of
 * shipping an ambiguous catalog to a remote API.
 */

import { allTools } from "./registry.js";
import type { ToolDefinition } from "@tau/core";

/** JSON Schema fragment for one tool parameter. */
export interface ToolParamJsonSchema {
  type: "string" | "number" | "boolean" | "array";
  description: string;
  items?: { type: "string" };
  default?: unknown;
}

/** JSON Schema `parameters` object for one tool. */
export interface ToolParametersJsonSchema {
  type: "object";
  properties: Record<string, ToolParamJsonSchema>;
  required: string[];
  /** Planners must not invent arguments outside the declared set. */
  additionalProperties: false;
}

/** OpenAI-compatible function tool wire shape (`tools[]` entry). */
export interface FunctionTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: ToolParametersJsonSchema;
  };
}

/** Longest function name accepted by the OpenAI-compatible wire grammar. */
const FUNCTION_NAME_MAX = 64;

/**
 * Map a dotted tool name to the wire-safe function name:
 * `file.find` → `file__find` (dot → double underscore; underscores and
 * word characters are legal, dots are not). Throws when the mapped name
 * would exceed the 64-char wire limit — fail fast at export time rather
 * than shipping a name a remote API would reject.
 */
export function functionNameFor(toolName: string): string {
  const mapped = toolName.replaceAll(".", "__");
  if (!/^[a-zA-Z0-9_-]+$/.test(mapped)) {
    throw new Error(`tool ${toolName}: mapped function name is not wire-safe: ${mapped}`);
  }
  if (mapped.length > FUNCTION_NAME_MAX) {
    throw new Error(
      `tool ${toolName}: mapped function name exceeds the ${FUNCTION_NAME_MAX}-char wire limit: ${mapped.length} chars`,
    );
  }
  return mapped;
}

/** Inverse of `functionNameFor`: `file__find` → `file.find`. */
export function toolNameFor(functionName: string): string {
  return functionName.replaceAll("__", ".");
}

/**
 * One tool → JSON Schema `parameters` object, mapped from ToolParamSpec
 * (string/number/boolean/string[] + required + default). Parameter defaults
 * ride in the description (JSON Schema `default` is advisory and many
 * planners ignore it — the text makes it unmissable).
 */
export function toolParametersJsonSchema(tool: ToolDefinition): ToolParametersJsonSchema {
  const properties: Record<string, ToolParamJsonSchema> = {};
  const required: string[] = [];
  for (const param of tool.params) {
    const descParts: string[] = [param.description];
    if (param.default !== undefined) {
      descParts.push(`Defaults to ${JSON.stringify(param.default)}.`);
    }
    const schema: ToolParamJsonSchema = {
      type: param.type === "string[]" ? "array" : param.type,
      description: descParts.join(" "),
    };
    if (param.type === "string[]") schema.items = { type: "string" };
    properties[param.name] = schema;
    if (param.required) required.push(param.name);
  }
  return { type: "object", properties, required, additionalProperties: false };
}

/**
 * Risk/mutation tags in the same visual language as `renderToolCatalog`, so
 * a function-calling planner sees the same safety signals the text catalog
 * carries (risk is intrinsic; the deterministic reviewer still grades every
 * plan — this export never bypasses it).
 */
function toolDescriptionWithTags(tool: ToolDefinition): string {
  const tags: string[] = [`risk:${tool.risk}`];
  if (tool.mutates) tags.push("mutates");
  if (tool.dryRunDefault) tags.push("dry-run-default");
  return `${tool.description} [${tags.join(", ")}]`;
}

/** All registered tools as OpenAI-compatible function-calling entries. */
export function functionTools(): FunctionTool[] {
  const tools = allTools();
  const seen = new Set<string>();
  return tools.map((tool) => {
    const fnName = functionNameFor(tool.name);
    if (seen.has(fnName)) {
      throw new Error(`function name collision after dot mapping: ${fnName}`);
    }
    seen.add(fnName);
    return {
      type: "function" as const,
      function: {
        name: fnName,
        description: toolDescriptionWithTags(tool),
        parameters: toolParametersJsonSchema(tool),
      },
    };
  });
}
