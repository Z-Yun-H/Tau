/**
 * Tool bootstrap — registers every built-in tool family (file, sys, net,
 * text) with the central registry exactly once at import time.
 */

import { registerTools } from "./registry.js";
import { fileTools } from "./file.js";
import { sysTools } from "./sys.js";
import { netTools } from "./net.js";
import { textTools } from "./text.js";
import type { ToolDefinition } from "@tau/core";

// Re-export the registry accessors for convenience.
export {
  registerTools,
  getTool,
  allTools,
  resetRegistry,
  renderToolCatalog,
  catalogSummary,
} from "./registry.js";

/** Register all built-in core tools. Idempotent: safe to call repeatedly. */
export function registerCoreTools(): void {
  const tools: ToolDefinition[] = [...fileTools, ...sysTools, ...netTools, ...textTools];
  registerTools(tools, { replace: true });
}
