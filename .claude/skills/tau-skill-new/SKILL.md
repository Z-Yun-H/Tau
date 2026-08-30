---
name: tau-skill-new
description: Create a new Tau skill (SKILL.md plugin) that passes validation. Use when asked to add a skill to Tau, extend tau with a new capability, or fix a failing tau skill validate.
---

# Create a Tau skill

## Authoritative spec

Read AGENTS.d/skills.md first — it defines the frontmatter contract and the
safety rules (read-only by default, no deny-list commands, `risk` semantics).

## Fast path (human-style)

```bash
npm run dev -- skill new my-skill "One-line description"
npm run dev -- skill validate my-skill
npm run dev -- skill show my-skill
```

## Manual path (when scaffolding from TypeScript/tests)

1. Create `skills/<name>/SKILL.md` (bundled) or instruct the user to create
   `$TAU_HOME/skills/<name>/SKILL.md` (user scope).
2. Frontmatter minimum: name (kebab-case), version (semver), description
   (>= 8 chars, specific enough for the AI planner to match intent).
3. Add declarative `commands:` for each safe operation. Every command runs
   through the shell after review — declare honest `risk`.
4. Body: usage docs + "deliberately excluded" section listing what you did
   NOT include for safety reasons (see git-helper for the pattern).
5. Validate: `npm run dev -- skill validate <name>` must print OK.
6. If you added validation rules or changed the parser, update
   `tests/unit/skills.test.ts` and the template in `templates/skill-template/`.

## Common validation failures

| Issue message                                    | Meaning                                     |
| ------------------------------------------------ | ------------------------------------------- |
| `name must be kebab-case`                        | use `[a-z][a-z0-9-]*`                       |
| `description should be descriptive`              | < 8 chars; the planner needs substance      |
| `matches the shell deny list and will never run` | command contains sudo/rm -rf/curl           | sh...; redesign the command |
| `missing or invalid YAML frontmatter`            | needs `---` fenced YAML block at file start |
