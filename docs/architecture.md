# Architecture

This is the human-facing deep dive. Agents: read `AGENTS/architecture.md`
for the rulebook version (same facts, normative wording).

> **Workspace layout (pnpm monorepo).** UI apps live in `app/*`, the reusable
> engine in `packages/*` — each an independent package (`@tau/*`) built with
> tsdown and wired through `workspace:*` dependencies. Paths below are quoted
> in full; `@tau/cli` is the terminal app, `@tau/tui` and `@tau/webui` reuse
> the same pipeline through `@tau/agent`.

## The pipeline

```
                 ┌──────────────────────────────────────────────────────────────────┐
 user intent ──► │ tau ask (app/cli/src/ask.ts)                                 │
                 │   1. resolveProvider()      packages/ai/src/registry.ts       │
                 │   2. planningContext()      packages/ai/src/prompt.ts         │
                 │      ├─ tool catalog  ←─ packages/tools/src/registry.ts    │
                 │      └─ skill catalog ←─ packages/skills/src/loader.ts    │
                 │   3. provider.plan()        packages/ai/src/providers/*       │
                 │      └─ validatePlanResponse()  zod, STRICT JSON                 │
                 │   4. runPlan()              packages/engine/src/session.ts  │
                 │      ├─ reviewPlan()        packages/engine/src/safety.ts   │
                 │      ├─ confirm UI          packages/ui/src/confirm.ts        │
                 │      ├─ executeStep()       packages/engine/src/executor.ts │
                 │      └─ appendHistory()     packages/core/src/config/history.ts  │
                 └──────────────────────────────────────────────────────────────────┘

 direct CLI (tau file find ...) ──► runToolDirect() ──► tool.run() ──► history
 tui / webui (tau tui, tau web) ──► @tau/agent planIntent() ──► runPlan() ──┘
```

## Module tour

### packages/core/src/types.ts — the vocabulary

Every subsystem speaks the same language: `Plan`, `PlanStep`, `ToolDefinition`,
`SkillMeta`, `SafetyReview`, `RiskLevel` (low < medium < high < blocked).
Change these and the typechecker will walk you through the consequences.

### packages/tools/src/ — the dual-use toolbelt

A `ToolDefinition` is both a CLI backend and a unit the AI planner can propose.
Tools return plain text (no ANSI — history must stay clean) and may throw;
callers render errors. Registration is idempotent for core tools and
throw-on-duplicate for skills (shadowing a core tool must fail loudly).

Families: `file.*`, `sys.*`, `net.*`, `text.*`. Design bias: read-only by
default; the two mutating tools (`file.rename`, `text.replace`) are dry-run
by default and carry `risk: medium`.

### packages/engine/src/safety.ts — the deterministic gate

Two pattern lists: `DENY_PATTERNS` (verdict: deny) and `CAUTION_PATTERNS`
(escalate to high risk). Plus structural rules: no steps, >10 steps, unknown
tool references, empty shell commands, >2000-char shell commands → blocked.
The reviewer is pure: same plan in, same verdict out, no network, no clock.

### packages/engine/src/session.ts — the only door to execution

`runPlan()` orchestrates review → confirm → execute → history. Anything that
runs AI-generated steps goes through it. Direct CLI tool runs bypass
confirmation (first-party code) but never bypass history.

### packages/ai/src/ — providers behind one interface

`AIProvider.plan(ctx) -> Plan`. Providers receive the REAL tool+skill catalog
in the system prompt, so they can only propose things that exist — and the
reviewer independently re-verifies that. `validatePlanResponse()` is strict
about content (zod `.strict()`), tolerant about wrapping (code fences, prose).

Providers: `mock` (offline keyword matching), `ollama` (local HTTP), `openai`
(any OpenAI-compatible endpoint), `deepseek` (official streaming wire format,
harness adapter with zero-dep fallback), `zai` (optional SDK, dynamically
imported).

Providers may also implement `listModels()` for live model discovery. The
catalog service (`packages/ai/src/models.ts`) caches ids per provider (24 h TTL) and
the `tau provider` command family (set-key / models / use) turns it into the
model-selection UX: configuring an API key auto-refreshes the catalog, then
you pick from real models. There are no bundled default models — with a
single-model catalog Tau auto-selects it, otherwise selection is explicit
(`tau provider use`) and the request-time resolver (`resolveModel`) fails
with an actionable hint when nothing is chosen. Keys live in config
(chmod 0600) with env vars as fallback and are masked in every CLI output.

### packages/skills/src/ — markdown as a plugin format

SKILL.md frontmatter (yaml + zod) → `SkillMeta`. Declarative `commands`
become tools named `<skill>.<command>` at startup. Three scopes with later-
wins precedence: bundled → user ($TAU_HOME/skills) → workspace (./skills,
./.tau/skills). Skills are data: nothing in a skill directory is ever
`eval`'d or dynamically imported.

### packages/core/src/config/ — where state lives

`$TAU_HOME` (default `~/.tau`, XDG-aware, overridable for tests):
`config.json` (provider, timeout, aliases, per-provider settings — may hold
API keys, so it is written with chmod 0600 and keys are masked on display),
`history.jsonl` (append-only, one `HistoryEntry` per line).

## Where things live (directory governance)

The normative table is in `AGENTS/architecture.md`; the short version:

- **Repo root**: `AGENTS.md` + `AGENTS/` (AI behavior rulebooks), `.claude/skills/`
  (dev-workflow SKILL.md files for coding agents — there is no root SKILL.md),
  `docs/`, `.github/`, workspace tooling.
- **`packages/skills/`**: `bundled/<name>/SKILL.md` (skills that ship with the
  CLI, resolved at runtime via `packageRoot()`) and `templates/` (the
  `tau skill new` scaffold, read at runtime).
- **Runtime, never committed**: `$TAU_HOME/skills/` (user skills), `config.json`,
  `history.jsonl`; plus the _user's_ project `./skills/` / `./.tau/skills/`
  scopes. Tau's own repo never contains user-scope skills.

## Invariants

1. `runPlan()` is the single execution path for AI plans.
2. `blocked` risk is terminal — no flag or config downgrades it.
3. Mutating tools dry-run by default.
4. The planner sees exactly what the reviewer will enforce.
5. History records everything that touched the world.

## Extending

- **New tool op** → `packages/tools/src/<family>.ts` (ToolDefinition) + CLI wiring in
  `app/cli/src/<family>.ts` + tests. Mutating? Make it dry-run default.
- **New provider** → `packages/ai/src/providers/<name>.ts` + registry + config defaults
  - tests with mocked fetch.
- **New skill** → just markdown; see docs/skills-authoring.md.

Full "I want to..." table lives in AGENTS/architecture.md.
