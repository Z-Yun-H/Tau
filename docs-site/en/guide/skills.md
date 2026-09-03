# Skills

Skills are Tau's lightweight extension mechanism: a skill is a `SKILL.md` file (plus optional docs) that injects structured context and **declarative commands** into the AI's prompt — no TypeScript required.

## Three scopes

| Scope     | Location                                              | Source             |
| --------- | ----------------------------------------------------- | ------------------ |
| bundled   | `packages/skills/bundled/` inside the package         | ships with the CLI |
| user      | `$TAU_HOME/skills/<name>/` (default `~/.tau/skills/`) | installed by you   |
| workspace | `./skills/` or `./.tau/skills/` in your project       | follows your repo  |

`tau skill list` shows all scopes; `tau skill new <name> "<description>"` scaffolds one from the official template.

## What a skill looks like

```
my-skill/
  SKILL.md      # frontmatter (name/description/risk) + command definitions + injection notes
```

Commands inside a skill are **declarative**: they define "this command expands into this intent/tool call", not executable scripts. Declared risk (low/medium/high) goes through the same review gate as built-in tools — medium+ commands still need confirmation, and skills can never bypass the safety model.

## Skills vs plugins (MCP)

Declarative commands, prompt injection, zero code → **skill**. A real external tool server (separate process, custom protocol implementation) → [plugin](/en/guide/plugins). Skills are document-level extensions; plugins are process-level extensions.

## Writing skills for the repo

To author skills for Tau's own development workflow (or to understand the three-layer SKILL.md model in this repo), see [authoring skills](/en/reference/skill-authoring).
