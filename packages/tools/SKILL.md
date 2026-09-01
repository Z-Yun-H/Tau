---
name: tau-tools-authoring
version: 0.1.0
description: Author, register, wire, and test Tau built-in tools (ToolDefinition) — registry contract, arg helpers, risk semantics, dry-run rules, CLI wiring, and the docs/tests checklist. Use when adding a tool to packages/tools, changing a tool's params or risk, or fixing a tool that renders wrong in the AI catalog.
author: Tau maintainers
tags: [tools, authoring, tau]
risk: low
---

# Tools authoring & maintenance (tool-layer skill)

> **Layer note.** This is the TOOL-LAYER skill of the `@tau/tools` package:
> it lives inside the package it governs and is versioned with it. Related
> entries: the root router is [`SKILL.md`](../../SKILL.md) (repo root), the
> thin L1 trigger router is
> [`.claude/skills/tau-tool-new/SKILL.md`](../../.claude/skills/tau-tool-new/SKILL.md),
> the normative specs are
> [AGENTS/architecture.md](../../AGENTS/architecture.md) and
> [AGENTS/ai-integration.md](../../AGENTS/ai-integration.md), and the
> human-facing deep dives are
> [docs/architecture.md](../../docs/architecture.md) and
> [docs/safety.md](../../docs/safety.md).

The frontmatter above follows the Tau skill contract for consistency, but
this file is NOT runtime data: the tau CLI never loads it (it is not under
`bundled/`). AI coding agents consume it through the `AGENTS.md` read chain.

## Where tools live (what this package owns)

| File                    | Contents                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `src/registry.ts`       | the registry Map + `registerTools/getTool/allTools/resetRegistry/renderToolCatalog` + arg helpers |
| `src/bootstrap.ts`      | `registerCoreTools()` — aggregates the four module arrays, registers with `{ replace: true }`     |
| `src/file.ts`           | `file.find/read/list/stat/tree/rename` (6)                                                        |
| `src/sys.ts`            | `sys.info/disk/proc/datetime/which/env` (6)                                                       |
| `src/net.ts`            | `net.port/ping/fetch/ip` (4)                                                                      |
| `src/text.ts`           | `text.count/search/replace/hash` (4)                                                              |
| `tests/tools-*.test.ts` | happy path + error path per tool op (vitest, no network)                                          |

Shared file-family primitives (`globToRegex`, `isProbablyBinary`,
`PRUNE_DIRS`) are exported from `file.ts` and reused by `text.ts` — do not
duplicate them.

## The contract: ToolDefinition (packages/core/src/types.ts)

Every tool is **dual-use**: a CLI subcommand for humans AND a catalog entry
the AI planner plans against. Both faces come from one definition:

| Field         | Rule                                                                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`        | dotted `<family>.<verb>` (e.g. `file.read`); duplicates throw unless `replace: true` — a duplicate is a bug signal, never catch it                   |
| `description` | one line, shown to humans AND matched by the AI planner — must be specific enough to plan against ("Read a text file with line numbers", not "read") |
| `params`      | `ToolParamSpec[]`: `name/type/description/required/default`; `type` ∈ `string \| number \| boolean \| string[]`                                      |
| `risk`        | honest intrinsic risk: `low` (read-only) / `medium` (see below) / `high`+`blocked` are rejected for built-ins in review                              |
| `owner`       | `"core"` for built-ins, the skill name for skill tools                                                                                               |
| `run`         | `async (args) => ToolResult` — `text` is PLAIN text (no ANSI; color lives in cli/ui only), `data` optional structured payload                        |

Arg coercion helpers — always parse through them, never hand-cast:
`strArg/numArg/boolArg` (coerce + default) and `textResult(text, data?)`.

## Risk semantics (current truth, keep it honest)

- `low` — read-only operations (the whole `net` family, `file.find/read/list/stat/tree`, `sys.info/disk/proc/datetime/which`, `text.count/search/hash`).
- `medium` — exactly three today, each for a stated reason: `file.rename` and
  `text.replace` (reversible mutation, **dry-run by default**, apply only with
  an explicit confirm flag) and `sys.env` (information exposure — env may hold
  secrets; reads one variable by exact NAME, never the whole environment).
- Never add delete/write primitives; destructive shell belongs to the reviewed
  plan path with deny-list scanning, not to a tool's `run()`.
- If a test around risk fails, fix the feature, not the reviewer
  (`packages/engine/src/safety.ts` is sacred).

## Fast path — adding a tool

1. Add the `ToolDefinition` to the owning module's exported array
   (`file.ts` / `sys.ts` / `net.ts` / `text.ts`). No manual registration:
   `registerCoreTools()` aggregates the arrays (`bootstrap.ts`).
2. Wire the CLI subcommand in `app/cli/src/<family>.ts` via
   `runToolDirect("<tool.name>", { mapped args }, "human label")` — the same
   bridge non-AI commands use, so review/dry-run semantics stay identical.
3. Tests in `packages/tools/tests/tools-<family>.test.ts`: happy path AND
   error path; dry-run default for anything mutating; no network sockets.
4. Update the docs table in BOTH READMEs (`README.md`, `README.zh-CN.md`
   Features section) and the package README (`packages/tools/README.md`).
5. Verify the catalog renders: `renderToolCatalog()` output is covered by
   tests; eyeball it with `pnpm dev -- file find "*.ts"` for the CLI face.
6. If you added a whole new module (not just a tool): export it from
   `src/index.ts` barrel, add it to `registerCoreTools()`, and update
   `AGENTS/architecture.md` — new module needs an approved Issue first.

## Common pitfalls

| Symptom                                    | Cause                                                                                   |
| ------------------------------------------ | --------------------------------------------------------------------------------------- |
| `Duplicate tool name: X`                   | registered without `replace: true` (skill tools) or name collides with a built-in       |
| planner never picks the tool               | description too vague or params under-specified — the catalog text IS the planner's API |
| ANSI escape in output breaks tests/UI      | tool returned styled text — return plain text, color only in `@tau/cli`/`@tau/ui`       |
| mutating tool applied without confirmation | missing dry-run default — mutating tools MUST preview until an explicit execute flag    |
| typecheck error on params                  | `type` must be the exact union member; `default` must match the declared type           |

## Checklist — changing the registry or contract

- [ ] `ToolParamSpec`/`ToolDefinition` changed? → `packages/core/src/types.ts` + this skill + `AGENTS/architecture.md` + tests updated together
- [ ] New tool has: CLI wiring, docs table rows (both languages), tests,
      honest `risk`, dry-run default if mutating
- [ ] `pnpm lint && pnpm typecheck && pnpm test` green; results in the PR
      body + commit `AI-gate:` trailer
