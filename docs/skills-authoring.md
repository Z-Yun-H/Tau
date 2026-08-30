# Skill Authoring Guide

A Tau skill is a directory with one `SKILL.md` file. That's it — no build
step, no code required (helper scripts are optional and never auto-executed).

## Where skills live

| Scope     | Location                                      | Wins when              |
| --------- | --------------------------------------------- | ---------------------- |
| bundled   | `<package>/skills/`                           | base                   |
| user      | `$TAU_HOME/skills/` (default `~/.tau/skills`) | same name as bundled   |
| workspace | `./skills/` or `./.tau/skills/`               | same name as the above |

Scaffold one instantly: `tau skill new my-skill "What it does"`.

## The frontmatter contract

```yaml
---
name: my-skill # required: kebab-case [a-z][a-z0-9-]*, unique
version: 0.1.0 # required: semver
description: > # required: >= 8 chars — this is what the AI matches
  One specific sentence about the capability.
author: you # optional
tags: [git, helper] # optional
risk: low # optional: overall risk floor (low|medium|high|blocked)
triggers: [git, 提交] # optional: keywords for intent matching
commands: # optional: declarative tools
  - name: status #   required: kebab-case
    description: ... #   required
    command: git status #   required: shell command, run AFTER review
    risk: low #   optional per command (default low)
---
```

Everything after the second `---` is markdown documentation — read by humans
and by the AI planner via `tau skill show <name>`.

## What happens to `commands`

Each command is registered at startup as a tool named `<skill>.<command>`
(e.g. `git-helper.status`). Concretely:

- **Humans** can run it: `tau git-helper status`
- **The AI planner** sees it in its catalog and may propose it as a plan step
- **The safety reviewer** trusts the declared `risk` — and enforces it

`{args}` placeholders are filled positionally from the `values` array:

```yaml
- name: grep
  description: Grep a pattern
  command: grep -rn {args} .
# tau my-skill grep "TODO"  -> grep -rn TODO .
```

Note the single braces. Docker-style `{{.Names}}` templates are safe because
Tau only substitutes `{args}`.

## Validation rules (enforced by `tau skill validate`)

| Rule                       | Failure message pattern                          |
| -------------------------- | ------------------------------------------------ |
| kebab-case name            | `name must be kebab-case`                        |
| semver version             | `version must be semver`                         |
| description ≥ 8 chars      | `description should be descriptive`              |
| command names kebab-case   | `command name must be kebab-case`                |
| deny-list scan on commands | `matches the shell deny list and will never run` |

Issues never crash the loader — broken skills surface as explicit, per-file
messages from `tau skill validate` and `tau skill list`.

## Safety guidance for authors

- **Stay read-only.** The bundled skills are all `risk: low` on purpose.
  Mutating work belongs in the reviewed plan path (`tau ask`), where the
  confirmation UI sees it.
- **Explain exclusions.** Follow the bundled skills' pattern: a
  "Deliberately excluded" section listing what you chose NOT to automate and
  why. Future maintainers (human and AI) will thank you.
- **Honest risk.** If a command genuinely mutates, declare `risk: medium`
  and explain it in the body. Never declare `low` to sneak past `--yes`.
- **No secrets in skills.** Skills are shareable files; keep tokens in your
  environment.

## Walkthrough: a real skill

```bash
$ tau skill new pr-summarizer "Summarize open PRs for a repo"
Created /home/z/.tau/skills/pr-summarizer
$ edit ~/.tau/skills/pr-summarizer/SKILL.md
$ tau skill validate pr-summarizer
OK — pr-summarizer passes validation (1 file(s) checked)
$ tau skill show pr-summarizer     # exactly what the AI planner sees
$ tau pr-summarizer open           # run a declarative command
```

## Publishing

Skills are just directories — commit them to your repo's `skills/` folder
(workspace scope) and collaborators get them on clone. To propose a skill for
Tau's bundled set, open a PR against `skills/` and include the output of
`tau skill validate <name>`.
