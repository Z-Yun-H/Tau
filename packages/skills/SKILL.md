---
name: tau-skills-authoring
version: 0.1.0
description: Author, validate, and maintain Tau SKILL.md skills — bundled scope layout, frontmatter contract, validation workflow, and parser-change checklist. Use when adding a skill to Tau, extending tau with a new capability, or fixing a failing tau skill validate.
author: Tau maintainers
tags: [skills, authoring, tau]
risk: low
---

# Skills authoring & maintenance (tool-layer skill)

> **Layer note.** This is the TOOL-LAYER skill of the `@tau/skills` package:
> it lives inside the package it governs and is versioned with it. Related
> entries: the root router is
> [`.claude/skills/tau-skill-new/SKILL.md`](../../.claude/skills/tau-skill-new/SKILL.md),
> the normative spec is [AGENTS/skills.md](../../AGENTS/skills.md), and the
> human-facing guide is
> [docs/skills-authoring.md](../../docs/skills-authoring.md). The full
> root / tool / product placement model is codified in `AGENTS/skills.md`
> ("SKILL.md files in THIS repo — three layers") and in the governance table
> of `AGENTS/architecture.md`.

The frontmatter above follows the Tau skill contract for consistency, but
this file is NOT runtime data: the tau CLI never loads it (it is not under
`bundled/`). AI coding agents consume it through the `AGENTS.md` read chain.

## Authoritative spec

Read [AGENTS/skills.md](../../AGENTS/skills.md) first — it defines the
frontmatter contract and the safety rules (read-only by default, no
deny-listed commands, honest `risk` semantics). This file is the
package-owned workflow that applies it.

## Where skills live (what this package owns)

| Scope     | Location                                    | Notes                                                                                                                                      |
| --------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| bundled   | `packages/skills/bundled/<name>/SKILL.md`   | ships with the CLI, resolved at RUNTIME via `src/assets.ts packageRoot()`                                                                  |
| scaffold  | `packages/skills/templates/skill-template/` | read at RUNTIME by `tau skill new` — keep it in the oxfmt `ignorePatterns` (`{{placeholders}}` must survive) and in this package's `files` |
| user      | `$TAU_HOME/skills/<name>/`                  | user scope, never committed                                                                                                                |
| workspace | `<cwd>/skills/`, `<cwd>/.tau/skills/`       | the USER'S project scope — Tau's own skills never live here                                                                                |

The bundled directory and the template are PRODUCT CONTENT (runtime data
consumed by the CLI), not agent skills. Do not move them without updating
`src/assets.ts` — `tau skill list` and `tau skill new` break, and the release
smoke test is the signal.

## Fast path (human-style)

```bash
pnpm dev -- skill new my-skill "One-line description"
pnpm dev -- skill validate my-skill
pnpm dev -- skill show my-skill
```

## Manual path (when scaffolding from TypeScript/tests)

1. Create `packages/skills/bundled/<name>/SKILL.md` (bundled) or instruct
   the user to create `$TAU_HOME/skills/<name>/SKILL.md` (user scope).
2. Frontmatter minimum: name (kebab-case), version (semver), description
   (>= 8 chars, specific enough for the AI planner to match intent).
3. Add declarative `commands:` for each safe operation. Every command runs
   through the shell after review — declare honest `risk`.
4. Body: usage docs + a "deliberately excluded" section listing what you did
   NOT include for safety reasons (`bundled/git-helper` is the pattern).
5. Validate: `pnpm dev -- skill validate <name>` must print OK.
6. Update in the same PR: `packages/skills/tests/skills.test.ts` (new rules
   or fixtures), `packages/skills/templates/skill-template/` (template or
   parser changes), `AGENTS/skills.md` (contract changes), and both READMEs
   (user-visible behavior).

## Common validation failures

| Issue message                                    | Meaning                                                         |
| ------------------------------------------------ | --------------------------------------------------------------- |
| `name must be kebab-case`                        | use `[a-z][a-z0-9-]*`                                           |
| `description should be descriptive`              | < 8 chars; the planner needs substance                          |
| `matches the shell deny list and will never run` | command contains a deny-listed pattern (e.g. sudo, rm -rf, curl | sh); redesign the command |
| `missing or invalid YAML frontmatter`            | needs a `---` fenced YAML block at the file start               |

## Checklist — changing the parser or schema

- [ ] `packages/skills/src/schema.ts` (zod) and `SkillMeta` in
      `packages/core/src/types.ts` updated together
- [ ] fixture SKILL.md files under `packages/skills/tests/` updated
- [ ] template changed? → `tau skill new demo-skill test` +
      `tau skill validate demo-skill` must pass out of the box
- [ ] `AGENTS/skills.md` contract section reflects the new field/rule
