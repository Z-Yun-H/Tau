# Authoring skills

This page targets contributors writing skills for the **Tau repository itself**. For user-facing skills, see the [skills guide](/en/guide/skills).

## The three-layer SKILL.md model

SKILL.md files in this repo come in three layers; placing one in the wrong layer is a governance error:

| Layer | Location                                        | Nature                                                                    |
| ----- | ----------------------------------------------- | ------------------------------------------------------------------------- |
| L1    | `.claude/skills/*/SKILL.md`                     | root dev-workflow skills (build/test/release/docs), cross-cutting         |
| L2    | `packages/<pkg>/SKILL.md`, `app/<app>/SKILL.md` | package-owned skills, versioned with what they govern                     |
| L3    | `packages/skills/bundled/<name>/`               | shipped **product content** (runtime data) users see via `tau skill list` |

The root `SKILL.md` is a **router**: it routes by subsystem to the one designated skill file and normative spec. Update the routing table when adding a skill — every dev tool has exactly one designated entry.

## Writing rules

- **Frontmatter required**: `name`, `description` (one sentence — when does this trigger), `risk`.
- **Content shape**: one-line positioning first (what this is, what it is not), then the operating paths, then common pitfalls. Prefer short and precise over long and complete.
- **Declarative commands**: L3 skill commands are declarations (they expand to intents), not scripts; declared risk passes the same gate as built-ins.
- **Spec references**: skills index and route; normative detail lives in `AGENTS/<topic>.md` linked from the skill — every rule is defined in exactly one place.

## User skills vs repo skills

- Capabilities for **users** → L3 `packages/skills/bundled/`, or `$TAU_HOME/skills/` / workspace `./skills/` (not in the repo).
- Workflows for the **development AI agent** → L1 or L2, in the repo, reviewed with the code.

## Checklist

A skill PR must include: complete frontmatter, the root routing table (for new root skills), a governance table row (`AGENTS/architecture.md`, for new locations), and a `tau skill list` output verification.
