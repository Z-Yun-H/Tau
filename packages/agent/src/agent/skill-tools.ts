/**
 * Skill-to-tool bridge — converts executable commands declared in SKILL.md
 * frontmatter into registry ToolDefinitions, so the AI planner sees (and can
 * call) skill commands like git-helper.status alongside the built-in tools.
 * Shell execution still funnels through @tau/engine's runShell with a fixed
 * 30s timeout; skill commands carry their declared risk into the review gate.
 */

import type { SkillMeta, ToolDefinition } from "@tau/core";
import { runShell } from "@tau/engine";

/** Build ToolDefinitions for every command declared by the scanned skills. */
export function buildSkillTools(skills: SkillMeta[]): ToolDefinition[] {
  const skillTools: ToolDefinition[] = [];
  for (const skill of skills) {
    for (const command of skill.commands) {
      skillTools.push({
        name: `${skill.name}.${command.name}`,
        description: `[skill:${skill.name}] ${command.description}`,
        params: [],
        risk: command.risk ?? "low",
        owner: skill.name,
        run: async (args) => {
          // {args} placeholders are filled positionally from args.values.
          const values = Array.isArray(args["values"]) ? (args["values"] as string[]) : [];
          let cmd = command.command;
          let idx = 0;
          while (cmd.includes("{args}")) {
            cmd = cmd.replace("{args}", values[idx] ?? "");
            idx++;
          }
          const outcome = await runShell(cmd, { timeoutSec: 30 });
          return { text: outcome.output || `(exit ${outcome.exitCode})`, data: outcome };
        },
      });
    }
  }
  return skillTools;
}
