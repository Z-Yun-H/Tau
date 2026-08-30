/**
 * Skill discovery — scans bundled, user (TAU_HOME) and workspace scopes,
 * applies first-wins shadowing across scopes, and renders the catalog that
 * gets injected into the AI planning prompt.
 */

import fs from "node:fs";
import path from "node:path";
import { bundledSkillsDir } from "./assets.js";
import { userSkillsDir } from "@tau/core";
import { loadSkillFile } from "./schema.js";
import type { SkillIssue, SkillMeta } from "@tau/core";

/**
 * Skill discovery. Search order (later wins on name conflict):
 *   1. bundled  — <package>/bundled/          shipped with tau
 *   2. user     — $TAU_HOME/skills/          ~/.tau/skills
 *   3. workspace— <cwd>/skills/ or .tau/skills/   project-local skills
 */
export interface SkillScan {
  skills: SkillMeta[];
  issues: SkillIssue[];
  dirs: Array<{ dir: string; origin: SkillMeta["origin"]; exists: boolean }>;
}

export function skillSearchDirs(cwd = process.cwd()): SkillScan["dirs"] {
  return [
    { dir: bundledSkillsDir(), origin: "bundled", exists: fs.existsSync(bundledSkillsDir()) },
    { dir: userSkillsDir(), origin: "user", exists: fs.existsSync(userSkillsDir()) },
    {
      dir: path.join(cwd, "skills"),
      origin: "workspace",
      exists: fs.existsSync(path.join(cwd, "skills")),
    },
    {
      dir: path.join(cwd, ".tau", "skills"),
      origin: "workspace",
      exists: fs.existsSync(path.join(cwd, ".tau", "skills")),
    },
  ];
}

export function scanSkills(cwd = process.cwd()): SkillScan {
  const skills = new Map<string, SkillMeta>();
  const issues: SkillIssue[] = [];
  const dirs = skillSearchDirs(cwd);

  for (const { dir, origin, exists } of dirs) {
    if (!exists) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const skillDir = path.join(dir, entry.name);
      const skillFile = entry.isDirectory()
        ? path.join(skillDir, "SKILL.md")
        : entry.isFile() && entry.name === "SKILL.md"
          ? skillDir
          : null;
      if (!skillFile || !fs.existsSync(skillFile)) continue;
      const result = loadSkillFile(skillFile, origin);
      issues.push(...result.issues);
      if (result.meta) {
        // Later origins override earlier ones with the same name.
        skills.set(result.meta.name, result.meta);
      }
    }
  }
  return {
    skills: [...skills.values()].sort((a, b) => a.name.localeCompare(b.name)),
    issues,
    dirs,
  };
}

/** Catalog text for the AI planner. */
export function renderSkillCatalog(skills: SkillMeta[]): string {
  return skills
    .map((skill) => {
      const cmds = skill.commands
        .map((c) => `    - ${c.name} [risk:${c.risk}]: ${c.description} → ${c.command}`)
        .join("\n");
      return `- ${skill.name} v${skill.version} [risk:${skill.risk}] ${skill.description}${
        skill.triggers.length > 0 ? `\n    triggers: ${skill.triggers.join(", ")}` : ""
      }${cmds ? `\n${cmds}` : ""}`;
    })
    .join("\n");
}
