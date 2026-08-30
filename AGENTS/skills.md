# AGENTS/skills.md — the SKILL.md system

Tau's skill system turns markdown files into (a) CLI capabilities, (b) AI
planner catalog entries, (c) validated, shareable knowledge. Three scopes,
later overrides earlier on name conflicts:

1. **bundled** — `<package>/skills/` ships with tau (git-helper, docker-helper)
2. **user** — `$TAU_HOME/skills/` (default `~/.tau/skills`)
3. **workspace** — `<cwd>/skills/` and `<cwd>/.tau/skills/`

## SKILL.md format contract

```markdown
---
name: my-skill # required, kebab-case, unique across scopes
version: 0.1.0 # required, semver
description: ... # required, >= 8 chars, THIS is what the AI matches
author: optional
tags: [a, b] # optional
risk: low # optional, floor risk (default low)
triggers: [kw1, kw2] # optional, matching keywords
commands: # optional, declarative tools
  - name: status #   kebab-case
    description: ... #   required
    command: git status #   required, run via shell AFTER review
    risk: low #   optional per command
---

Markdown body — usage docs, guidance for AI agents, examples.
```

Validation lives in `packages/skills/src/schema.ts` (zod + safety scan). A skill whose
command matches any `DENY_PATTERNS` entry still loads but is flagged as an
issue by `tau skill validate` — never silently dropped.

## Behavior rules agents must keep

1. **Declarative commands become tools** named `<skill>.<command>` registered
   in `buildProgram()` (app/cli/src/index.ts). They run through `runShell` with
   default timeout. Their declared `risk` is what the reviewer trusts.
2. **`{args}` placeholder**: single braces, filled positionally from the
   `values` arg array. Docker templates use `{{.X}}` double braces — they
   never collide. Keep it that way.
3. **Keep skills read-only by default.** Any mutating capability belongs in
   the reviewed plan path, not in a declarative command. If a bundled skill
   genuinely needs `medium`, explain why in its body; `high`/`blocked` are
   rejected for bundled skills in review.
4. **Skill files are data, not code**: the parser tolerates arbitrary
   markdown after frontmatter; never `eval` or dynamic-import anything from a
   skill dir. Helpers in `scripts/` are user-invoked only.
5. Name conflicts: workspace > user > bundled wins. `registerTools` throws on
   duplicates — that's a bug signal, not something to catch and ignore.

## tau skill subcommands (packages/skills/src/manager.ts)

| Command                           | Purpose                                                   |
| --------------------------------- | --------------------------------------------------------- |
| `tau skill list [--json]`         | all scopes, with origin + risk                            |
| `tau skill show <name>`           | exactly what the planner sees + raw SKILL.md              |
| `tau skill new <name> [desc]`     | scaffold from `templates/skill-template/` into user scope |
| `tau skill validate <name\|path>` | frontmatter + safety scan; exit 1 on issues               |

## Checklist for touching skills code

- [ ] `scanSkills()` still merges scopes in documented precedence
- [ ] invalid SKILL.md → issues, never a crash (loader never throws)
- [ ] new frontmatter field? → zod schema + SkillMeta + this spec + template
- [ ] template updated? → `tau skill new demo-skill test` creates a valid,
      `tau skill validate` -passing skill out of the box
- [ ] tests cover any new validation rule (tests/unit/skills.test.ts)
