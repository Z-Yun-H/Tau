# AGENTS/architecture.md — module map & data flow

Owner of truth for how data moves. Update this file whenever you change the
pipeline, add a command family, or add a module.

## Workspace layout (normative)

pnpm monorepo: UI apps in `app/*` (`@tau/cli`, `@tau/tui`, `@tau/webui`), the
engine in `packages/*` (`@tau/core`, `@tau/tools`, `@tau/engine`, `@tau/ai`,
`@tau/skills`, `@tau/plugins`, `@tau/agent`, `@tau/ui`). Every package exposes
its API through a `src/index.ts` barrel and is consumed only via declared
`@tau/*` `workspace:*` deps. Dependency direction (no cycles):
`core ← tools ← engine`; `core+tools ← ai|plugins`; `skills → core+engine+ui`;
everything feeds `@tau/agent`; apps sit on top. Tests are colocated per
package and run by the single root vitest config (aliases `@tau/*` → source).

## The one diagram that matters

```
                 ┌──────────────────────────────────────────────────────────────────┐
 user intent ──► │ tau ask (app/cli/src/ask.ts)                                 │
                 │   1. resolveProvider()      packages/ai/src/registry.ts       │
                 │   2. planningContext()      packages/ai/src/prompt.ts         │
                 │      ├─ registerPluginTools()  packages/plugins/.../runtime.ts   │
                 │      │    (MCP discovery; failures → warnings)                   │
                 │      ├─ tool catalog  ←─ packages/tools/src/registry.ts    │
                 │      └─ skill catalog ←─ packages/skills/src/loader.ts    │
                 │   3. provider.plan()        packages/ai/src/providers/*       │
                 │      └─ validatePlanResponse()  zod, STRICT JSON                 │
                 │   4. runPlan()              packages/engine/src/session.ts  │
                 │      ├─ reviewPlan()        packages/engine/src/safety.ts   │
                 │      │    deny / review / allow                                  │
                 │      ├─ confirm UI          packages/ui/src/confirm.ts        │
                 │      ├─ executeStep()       packages/engine/src/executor.ts │
                 │      │    tool steps → registry.run                              │
                 │      │    shell steps → spawn (shell:true)                       │
                 │      └─ appendHistory()     packages/core/src/config/history.ts  │
                 └──────────────────────────────────────────────────────────────────┘

 direct CLI (tau file find ...) ──► runToolDirect() ──► tool.run() ──► history
 tui / webui (tau tui, tau web) ──► @tau/agent planIntent() ──► runPlan() ──┘
```

## Invariants (do not break)

1. `runPlan()` is the ONLY path that executes AI-generated steps. Direct CLI
   tool runs skip confirmation because they are first-party code, but still
   write history.
2. `validatePlanResponse()` rejects anything that is not strict JSON within
   the zod schema BEFORE the safety reviewer sees it. Garbage in → clean
   error out, never partial execution.
3. `reviewPlan()` is deterministic: same plan → same verdict. No network, no
   randomness, no time-dependence.
4. Registry is append-only at runtime: core tools register once in
   `buildProgram()`, then skill tools. Name conflicts throw — including a
   skill shadowing a core tool (`file.find` as a skill command must fail).
5. `blocked` risk is terminal. Nothing in the codebase may downgrade it.

## Where to add things (the "I want to..." table)

| I want to...                                | Do this                                                                                                                                                                                                                |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| add a built-in tool op (e.g. `file.dedupe`) | implement in `packages/tools/src/<family>.ts` as ToolDefinition + register in the family array + add CLI wiring in `app/cli/src/<family>.ts` + tests. Consider dry-run default if it mutates.                          |
| add a command family (e.g. `tau pkg`)       | new `packages/tools/src/pkg.ts` + `app/cli/src/pkg.ts` + register both in `app/cli/src/index.ts buildProgram()` + update this file + both READMEs                                                                      |
| add an AI provider                          | implement AIProvider in `packages/ai/src/providers/<name>.ts` + register in `packages/ai/src/registry.ts` + config defaults in `packages/core/src/config/store.ts DEFAULT_CONFIG.providers` + AGENTS/ai-integration.md |
| integrate an external tool server (MCP)     | nothing to code — `tau plugin add`; changing the MCP layer itself → `packages/plugins/src/*` + AGENTS/plugins.md (plugin tools are ALWAYS medium risk)                                                                 |
| add a bundled skill                         | new dir `packages/skills/bundled/<name>/SKILL.md` (spec: AGENTS/skills.md; authoring workflow: the tool-layer skill `packages/skills/SKILL.md`) — no TS code required for declarative commands                         |
| change the plan schema                      | `packages/ai/src/prompt.ts planSchema` + safety reviewer expectations + tests + this diagram                                                                                                                           |
| change config keys                          | `packages/core/src/types.ts TauConfig` + `packages/core/src/config/store.ts` (defaults + VALID_KEYS) + READMEs                                                                                                         |
| add model discovery to a provider           | optional `listModels()` on the provider (throw on failure) + `packages/ai/src/models.ts` handles caching; UI via `tau provider` (app/cli/src/provider.ts); contract in AGENTS/ai-integration.md                        |

## Directory governance (normative)

Where things live — and must KEEP living. Root vs package placement is not
accidental; do not relocate these without updating this table in the same PR.

| Location                 | Contents                                                                                                 | Why here                                                                                                                                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **repo root**            | `AGENTS.md`, `AGENTS/`                                                                                   | AI agent entry + per-subsystem rulebooks (mandatory read chain)                                                                                                                                                              |
| repo root                | `.claude/skills/*/SKILL.md`                                                                              | L1 ROOT dev-workflow skills for AI coding agents (tau-build, tau-test, tau-release; tau-skill-new is a thin ROUTER to the tool layer) — cross-cutting workflows + the agent-skill discovery entry; there is NO root SKILL.md |
| repo root                | `docs/`, `.github/`, `.devcontainer/`, `.gitmessage`                                                     | human deep dives, CI/PR automation, commit template                                                                                                                                                                          |
| repo root                | `package.json`, `pnpm-workspace.yaml` (catalog), `tsdown.config.ts`, `vitest.config.ts`, `tsconfig.json` | workspace-wide tooling; dependency versions live ONLY in the catalog                                                                                                                                                         |
| **`packages/skills/`**   | `bundled/<name>/SKILL.md`                                                                                | L3 PRODUCT CONTENT: user-facing skills that SHIP with the CLI — resolved at runtime via `packageRoot()` (moving them breaks `tau skill list`); runtime DATA for the product, not agent skills                                |
| `packages/<pkg>/`        | `SKILL.md` (today only `packages/skills/SKILL.md` — `tau-skills-authoring`)                              | L2 TOOL layer: package-owned agent skills, versioned WITH the package they govern; discovered via the AGENTS.md read chain, NOT Claude Code root discovery — add one here when knowledge is bound to a single package        |
| `packages/skills/`       | `templates/skill-template/`                                                                              | L3 PRODUCT CONTENT: scaffold source for `tau skill new` — read at RUNTIME; keep in `ignorePatterns` of oxfmt (`{{placeholders}}` must survive) and in package `files`                                                        |
| **runtime `$TAU_HOME/`** | `skills/<name>/` (user scope), `config.json`, `history.jsonl`                                            | never committed; tests override `TAU_HOME`                                                                                                                                                                                   |
| runtime workspace        | `./skills/`, `./.tau/skills/`                                                                            | workspace-scope skills of the _user's_ project — never Tau's own skills                                                                                                                                                      |

Rule of thumb: AI _behavior_ docs → root (`AGENTS*`); cross-cutting AI
_executable dev skills_ → root (`.claude/skills/`, L1); _single-package AI
skills_ → next to the code they govern (`packages/<pkg>/SKILL.md`, L2);
_shipped user skills and the scaffold_ → `packages/skills/` (L3 product
content — runtime data); _everything the CLI reads at runtime from the
user's machine_ → `$TAU_HOME`/workspace scope, never the repo. Layer
definitions: [AGENTS/skills.md](./skills.md) — "SKILL.md files in THIS repo —
three layers".

## Runtime data layout ($TAU_HOME, default ~/.tau)

```
$TAU_HOME/
  config.json      TauConfig (provider, timeout, aliases, plugins[], providers.*)
                   — may hold providers.<name>.apiKey; chmod 0600, keys masked in CLI output
  history.jsonl    append-only HistoryEntry per line
  skills/<name>/   user skills (highest precedence for name conflicts)
```

`TAU_HOME` env var overrides everything — tests rely on this. Never read
`~/.tau` directly; always go through `packages/core/src/config/paths.ts`.

## Key type glossary (packages/core/src/types.ts is the source)

- `PlanStep` — one action: `tool` (registry lookup) or `shell` (reviewed spawn)
- `Plan` — explanation + steps; what providers return and runPlan executes
- `SafetyReview` — verdict allow/review/deny + issues; from reviewPlan()
- `ToolDefinition` — name/description/params/risk/run; dual-use unit
- `PluginConfig` — one MCP server (transport stdio|http, endpoint, env/headers)
- `ModelInfo` — one discovered model id (+owner); served by `packages/ai/src/models.ts`
- `SkillMeta` — parsed SKILL.md frontmatter
- `RiskLevel` — low < medium < high < blocked (RISK_ORDER)
