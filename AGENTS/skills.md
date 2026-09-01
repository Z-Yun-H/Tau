# AGENTS/skills.md — the SKILL.md system

Tau's skill system turns markdown files into (a) CLI capabilities, (b) AI
planner catalog entries, (c) validated, shareable knowledge. Three scopes,
later overrides earlier on name conflicts:

1. **bundled** — `packages/skills/bundled/` ships with tau (git-helper, docker-helper)
2. **user** — `$TAU_HOME/skills/` (default `~/.tau/skills`)
3. **workspace** — `<cwd>/skills/` and `<cwd>/.tau/skills/`

## SKILL.md files in THIS repo — three layers

Not every `SKILL.md` in this repository is a Tau runtime skill. Three
distinct layers exist; placement is normative (see also the governance table
in [AGENTS/architecture.md](./architecture.md)):

> **Above the layers sits the root router [`/SKILL.md`](../SKILL.md)
> (`tau-dev-router`)** — an index, not a knowledge layer. It routes every
> dev tool (build / test / release / skills / WebUI / tools / AI / plugins /
> TUI) to its one designated L1/L2 skill and AGENTS spec, and must gain (or
> lose) a row in the same PR as any L1/L2 skill add/remove.

| Layer                    | Location                                                                               | Consumed by                                                                        | Versions with    |
| ------------------------ | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------- |
| **L1 root dev-workflow** | `.claude/skills/<name>/SKILL.md`                                                       | AI coding agents (Claude Code root discovery + the AGENTS.md read chain)           | the repo         |
| **L2 tool-layer**        | `packages/<pkg>/SKILL.md` or `app/<app>/SKILL.md`                                      | AI coding agents (AGENTS.md read chain — there is NO package-level auto-discovery) | the package/app  |
| **L3 product content**   | `packages/skills/bundled/<name>/SKILL.md`, `packages/skills/templates/skill-template/` | the tau CLI at RUNTIME (user-facing data, not agent skills)                        | the npm artifact |

Today's inventory — root router: `/SKILL.md` (`tau-dev-router`); L1:
`tau-build`, `tau-test`, `tau-release`, `tau-skill-new` (a thin ROUTER);
L2: `packages/skills/SKILL.md`
(`tau-skills-authoring`, owned by `@tau/skills`) and `app/webui/SKILL.md`
(`tau-webui-design`, owned by the WebUI app); L3: `git-helper`,
`docker-helper`, `skill-template`.

Placement rule of thumb: a cross-cutting repo workflow → L1; knowledge bound
to ONE package or app → L2, next to the code it governs (optionally keep a
thin L1 router with the original name/description so Claude Code trigger
discoverability survives); anything the CLI loads at runtime → L3, never
`.claude/`. Every L1/L2 skill add/remove/rename updates its row in the root
router `/SKILL.md` in the same PR — a stale row is dead documentation. Never
mix layers: L3 files are data for the product, L1/L2 files are instructions
for coding agents — a file can only be one of them.

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
- [ ] contract or workflow changed? → the L2 skill `packages/skills/SKILL.md`
      and, if its trigger wording changed, the L1 router
      `.claude/skills/tau-skill-new/` updated together
- [ ] template updated? → `tau skill new demo-skill test` creates a valid,
      `tau skill validate` -passing skill out of the box
- [ ] tests cover any new validation rule (packages/skills/tests/skills.test.ts)
