import { theme } from "../ui/theme.js";
import { getTool } from "../tools/registry.js";
import { appendHistory } from "../config/history.js";
import type { ToolResult } from "../types.js";
import { loadConfig } from "../config/store.js";

/**
 * Shared helpers for direct CLI tool invocation (tau file/sys/net/text ...).
 * Direct runs are first-party code: no interactive confirm needed, but they
 * still go to history so `tau history replay` works everywhere.
 */
export async function runToolDirect(
  toolName: string,
  args: Record<string, unknown>,
  inputLabel: string,
): Promise<void> {
  const tool = getTool(toolName);
  if (!tool) {
    console.error(theme.error(`Tool not registered: ${toolName}`));
    process.exitCode = 1;
    return;
  }
  try {
    const result: ToolResult = await tool.run(args);
    if (result.text.trim().length > 0) console.log(result.text);
    appendHistory(
      inputLabel,
      "direct",
      [{ kind: "tool", tool: toolName, args, reason: "direct CLI run" }],
      "ok",
      {
        exitCode: 0,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(theme.error(`${toolName}: ${message}`));
    appendHistory(
      inputLabel,
      "direct",
      [{ kind: "tool", tool: toolName, args, reason: "direct CLI run" }],
      "failed",
      {
        exitCode: 1,
      },
    );
    process.exitCode = 1;
  }
}

export function globalOptions(cmd: { optsWithGlobals: () => Record<string, unknown> }): {
  provider?: string;
  yes: boolean;
  json: boolean;
} {
  const opts = cmd.optsWithGlobals();
  return {
    provider: typeof opts["provider"] === "string" ? opts["provider"] : undefined,
    yes: opts["yes"] === true,
    json: opts["json"] === true,
  };
}

export function timeoutSec(): number {
  return loadConfig().timeout;
}
