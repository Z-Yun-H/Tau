---
name: tau-skill-new
description: Create a new Tau skill (SKILL.md plugin) that passes validation. Use when asked to add a skill to Tau, extend tau with a new capability, or fix a failing tau skill validate.
---

# Create a Tau skill (root router)

> **Layer note — this is a ROUTER, not the content.** The owning content of
> this workflow is the TOOL-LAYER skill
> [`packages/skills/SKILL.md`](../../../packages/skills/SKILL.md)
> (`tau-skills-authoring`, versioned with `@tau/skills`). Read that file for
> the full authoring guide: where bundled skills live, the frontmatter
> minimums, the manual authoring path, the validation-failure table, and the
> parser-change checklist. The three-layer placement model (root /
> package tool layer / shipped product content) is codified in
> `AGENTS/skills.md`.

## Normative spec

[AGENTS/skills.md](../../../AGENTS/skills.md) defines the frontmatter
contract and the safety rules (read-only by default, no deny-listed
commands, honest `risk`). Read it before authoring anything.

## Fast path (from the repo root)

```bash
pnpm dev -- skill new my-skill "One-line description"
pnpm dev -- skill validate my-skill
pnpm dev -- skill show my-skill
```
