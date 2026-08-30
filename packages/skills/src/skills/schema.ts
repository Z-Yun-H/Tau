/**
 * SKILL.md contract — YAML frontmatter parsing, zod-strict metadata
 * validation, and blacklist scanning of commands/paths so a skill can never
 * smuggle destructive operations past the safety layer.
 */

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type { RiskLevel, SkillCommand, SkillIssue, SkillMeta } from "@tau/core";
import { DENY_PATTERNS } from "@tau/engine";

/**
 * SKILL.md contract (see AGENTS/skills.md for the full spec):
 *
 * ---
 * name: git-helper            # required, kebab-case, unique
 * version: 0.1.0              # semver
 * description: ...            # required, shown to humans AND the AI planner
 * author: you
 * tags: [git, vcs]
 * risk: low                   # overall risk floor of this skill
 * triggers: [git, commit]     # keywords for matching
 * commands:                   # declarative, low-risk commands (optional)
 *   - name: status
 *     description: Show working tree status
 *     command: git status --short --branch
 *     risk: low
 * ---
 * Markdown body = usage documentation + guidance for AI agents.
 */

const riskSchema = z.enum(["low", "medium", "high", "blocked"]);

const commandSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z][a-z0-9-]*$/, "command name must be kebab-case"),
  description: z.string().min(1),
  command: z.string().min(1),
  risk: riskSchema.optional().default("low"),
});

const skillFrontmatterSchema = z.object({
  name: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z][a-z0-9-]*$/, "name must be kebab-case"),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "version must be semver (e.g. 0.1.0)"),
  description: z.string().min(8, "description should be descriptive (>= 8 chars)"),
  author: z.string().optional(),
  tags: z.array(z.string()).optional().default([]),
  risk: riskSchema.optional().default("low"),
  triggers: z.array(z.string()).optional().default([]),
  commands: z.array(commandSchema).optional().default([]),
});

export function parseFrontmatter(
  raw: string,
): { data: Record<string, unknown>; body: string } | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return null;
  try {
    const data = YAML.parse(match[1] ?? "") as Record<string, unknown>;
    if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
    return { data, body: match[2] ?? "" };
  } catch {
    return null;
  }
}

export interface LoadSkillResult {
  meta?: SkillMeta;
  body?: string;
  issues: SkillIssue[];
}

/** Load + validate one SKILL.md file. Never throws; returns issues instead. */
export function loadSkillFile(filePath: string, origin: SkillMeta["origin"]): LoadSkillResult {
  const issues: SkillIssue[] = [];
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    return {
      issues: [
        {
          path: filePath,
          message: `unreadable: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }

  const fm = parseFrontmatter(raw);
  if (!fm) {
    return {
      issues: [{ path: filePath, message: "missing or invalid YAML frontmatter (--- ... ---)" }],
    };
  }

  const parsed = skillFrontmatterSchema.safeParse(fm.data);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({
        path: filePath,
        message: `${issue.path.join(".") || "(root)"}: ${issue.message}`,
      });
    }
    return { issues };
  }

  const data = parsed.data;

  // Safety scan: skill commands must not match the shell deny list.
  let maxRisk: RiskLevel = data.risk;
  const riskOrder: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, blocked: 3 };
  for (const command of data.commands) {
    for (const pattern of DENY_PATTERNS) {
      if (pattern.test(command.command)) {
        issues.push({
          path: filePath,
          message: `command "${command.name}" matches the shell deny list and will never run: ${command.command}`,
        });
      }
    }
    if (riskOrder[command.risk] > riskOrder[maxRisk]) maxRisk = command.risk;
  }

  const commands: SkillCommand[] = data.commands.map((c) => ({ ...c }));
  return {
    meta: {
      name: data.name,
      version: data.version,
      description: data.description,
      author: data.author,
      tags: data.tags,
      risk: maxRisk,
      triggers: data.triggers,
      commands,
      sourcePath: filePath,
      dir: path.dirname(filePath),
      origin,
    },
    body: fm.body,
    issues,
  };
}
