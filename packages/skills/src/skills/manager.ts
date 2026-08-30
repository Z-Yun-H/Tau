/**
 * tau skill operations — list/show/new/validate implementations:
 * scaffold a new skill from the template, pretty-print metadata, run the
 * schema validator and report every issue with a fix hint.
 */

import fs from "node:fs";
import path from "node:path";
import { theme } from "@tau/ui";
import { scanSkills } from "./loader.js";
import { loadSkillFile } from "./schema.js";
import { templatesDir } from "./assets.js";
import { userSkillsDir } from "@tau/core";

/**
 * tau skill subcommands: list / show / new / validate
 */

export function listSkills(json = false): string {
  const scan = scanSkills();
  if (json) return JSON.stringify(scan.skills, null, 2);
  if (scan.skills.length === 0) {
    return `${theme.warn("No skills found.")} Create one with ${theme.brand("tau skill new <name>")}`;
  }
  const lines = [
    `${theme.bold(String(scan.skills.length))} skill(s) available:`,
    "",
    ...scan.skills.map((skill) => {
      const originTag = theme.muted(`[${skill.origin}]`);
      return `  ${theme.brand(skill.name.padEnd(18))} v${skill.version}  ${theme.risk(skill.risk)}  ${originTag} ${skill.description}`;
    }),
  ];
  return lines.join("\n");
}

export function showSkill(name: string): string {
  const scan = scanSkills();
  const skill = scan.skills.find((s) => s.name === name);
  if (!skill) {
    return `${theme.error(`Skill "${name}" not found.`)} Try: ${theme.brand("tau skill list")}`;
  }
  const raw = fs.readFileSync(skill.sourcePath, "utf8");
  const lines = [
    theme.title(`${skill.name} v${skill.version}`) +
      theme.muted(`  [${skill.origin}] ${skill.sourcePath}`),
    skill.description,
    "",
    `${theme.bold("risk:")} ${theme.risk(skill.risk)}   ${theme.bold("triggers:")} ${skill.triggers.join(", ") || "—"}`,
  ];
  if (skill.commands.length > 0) {
    lines.push("", theme.bold("commands:"));
    for (const c of skill.commands) {
      lines.push(`  ${theme.brand(c.name)} — ${c.description}`);
      lines.push(`    ${theme.muted("$")} ${c.command}`);
    }
  }
  lines.push("", theme.muted("— full SKILL.md —"), raw.trim());
  return lines.join("\n");
}

export function validateSkill(nameOrPath: string): { text: string; ok: boolean } {
  const target = path.resolve(process.cwd(), nameOrPath);
  const isFile = fs.existsSync(target) && fs.statSync(target).isFile();
  let results;
  if (isFile) {
    results = [loadSkillFile(target, "workspace")];
  } else {
    const scan = scanSkills();
    results = scan.skills
      .filter((s) => s.name === nameOrPath)
      .map((s) => loadSkillFile(s.sourcePath, s.origin));
    if (results.length === 0) {
      return {
        text: theme.error(`No skill named "${nameOrPath}" and not a file path.`),
        ok: false,
      };
    }
  }
  const issues = results.flatMap((r) => r.issues);
  if (issues.length === 0) {
    return {
      text: `${theme.ok("OK")} — ${nameOrPath} passes validation (${results.length} file(s) checked)`,
      ok: true,
    };
  }
  return {
    text: [
      theme.error(`${issues.length} issue(s) in ${nameOrPath}:`),
      ...issues.map(
        (i) => `  ${theme.warn("•")} ${path.relative(process.cwd(), i.path)}: ${i.message}`,
      ),
    ].join("\n"),
    ok: false,
  };
}

/** Scaffold a new skill from the bundled template into ~/.tau/skills/<name>/. */
export function newSkill(name: string, description?: string): string {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    return theme.error("Skill name must be kebab-case (a-z, 0-9, dashes), e.g. git-helper");
  }
  const targetDir = path.join(userSkillsDir(), name);
  if (fs.existsSync(targetDir)) {
    return theme.error(`Skill already exists: ${targetDir}`);
  }

  const template = path.join(templatesDir(), "skill-template");
  const tmplFile = path.join(template, "SKILL.md");
  if (!fs.existsSync(tmplFile)) {
    return theme.error(`Template not found: ${tmplFile}`);
  }
  let raw = fs.readFileSync(tmplFile, "utf8");
  raw = raw
    .replace(/{{name}}/g, name)
    .replace(/{{description}}/g, description ?? `TODO: describe what the ${name} skill does`);

  fs.mkdirSync(path.join(targetDir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(targetDir, "SKILL.md"), raw, "utf8");

  const scriptTmpl = path.join(template, "scripts", "main.mjs");
  if (fs.existsSync(scriptTmpl)) {
    fs.copyFileSync(scriptTmpl, path.join(targetDir, "scripts", "main.mjs"));
  }

  return [
    `${theme.ok("Created")} ${targetDir}`,
    "",
    "Next steps:",
    `  1. Edit ${theme.brand(path.join(targetDir, "SKILL.md"))} — fill in description + commands`,
    `  2. ${theme.brand(`tau skill validate ${name}`)} — check it`,
    `  3. ${theme.brand(`tau skill show ${name}`)} — see it the way the AI sees it`,
  ].join("\n");
}
