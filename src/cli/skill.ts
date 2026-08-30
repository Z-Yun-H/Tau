/**
 * tau skill — manage SKILL.md skills: list/show/new/validate over the
 * three-scope loader and the frontmatter contract in skills/schema.ts.
 */

import type { Command } from "commander";
import { listSkills, newSkill, showSkill, validateSkill } from "../skills/manager.js";
import { globalOptions } from "./util.js";

export function registerSkillCommands(program: Command): void {
  const skill = program.command("skill").description("Manage Tau skills (SKILL.md plugins)");

  skill
    .command("list")
    .description("List discovered skills (bundled + user + workspace)")
    .action((_opts, command) => {
      console.log(listSkills(globalOptions(command).json));
    });

  skill
    .command("show")
    .description("Show one skill exactly the way the AI planner sees it")
    .argument("<name>", "skill name")
    .action((name: string) => {
      console.log(showSkill(name));
    });

  skill
    .command("new")
    .description("Scaffold a new skill from the bundled template into ~/.tau/skills/")
    .argument("<name>", "kebab-case skill name")
    .argument("[description...]", "what the skill does")
    .action((name: string, descriptionParts: string[]) => {
      console.log(newSkill(name, descriptionParts.join(" ") || undefined));
    });

  skill
    .command("validate")
    .description("Validate a skill by name or by SKILL.md path")
    .argument("<name-or-path>", "skill name or path to SKILL.md")
    .action((nameOrPath: string) => {
      const result = validateSkill(nameOrPath);
      console.log(result.text);
      if (!result.ok) process.exitCode = 1;
    });
}
