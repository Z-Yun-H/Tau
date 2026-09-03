# AGENTS/architecture.md — module map & data flow

Owner of truth for how data moves. Update this file whenever you change the
pipeline, add a command family, or add a module.

## Workspace layout (normative)

pnpm monorepo: UI apps in `app/*` (`@tau/cli`, `@tau/tui`, `@tau/webui`), the
engine in `packages/*` (`@tau/core`, `@tau/tools`, `@tau/engine`, `@tau/ai`,
`@tau/skills`, `@tau/plugins`, `@tau/agent`, `@tau/ui`, `@tau/markdown`). Every
package exposes
its API through a `src/index.ts` barrel and is consumed only via declared
`@tau/*` `workspace:*` deps. Dependency direction (no cycles):
`core ← tools ← engine`; `core+tools ← ai|plugins`; `skills → core+engine+ui`;
`markdown` stands alone (marked + chalk only) and is consumed by front-door
surfaces (TUI/WebUI) — never by the engine; everything feeds `@tau/agent`; apps
sit on top. Tests are colocated per
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
                 │      │    shell steps → buildShellInvocation                    │
                 │      │      (native shell:true | explicit pwsh argv)            │
                 │      └─ appendHistory()     packages/core/src/config/history.ts  │
                 └──────────────────────────────────────────────────────────────────┘

 direct CLI (tau file find ...) ──► runToolDirect() ──► tool.run() ──► history
 tui / webui (tau tui, tau web) ──► @tau/agent planIntent() ──► runPlan() ──┘
```

## The agent loop (v0.4.0 — multi-round goals)

`runGoal()` (packages/agent/src/loop.ts) is ORCHESTRATION over the same
single-round pipeline — never a second execution channel:

```
 intent ──► runGoal()  packages/agent/src/loop.ts
              round 1: planIntent() ──► reviewPlan() ──► runPlan()   (unchanged)
              reflect: provider.reflect?(ReflectContext)             (optional capability)
                 ├─ { done: true, answer }  ──► goal_end ok
                 └─ { done: false, plan }   ──► reviewPlan() AGAIN
                       ├─ deny    → goal_end denied (nothing runs)
                       ├─ review  → awaitApproval() pause | runPlan's own confirm
                       └─ allow   → runPlan() → loop (cap: default 3, hard 5)
```

Invariants added on top of the base set:

- Reflection is an OPTIONAL provider capability (so far: mock, openai).
  Providers without it degrade to one executed round and say so honestly.
- The loop reuses the FIRST round's planning-context snapshot for every
  reflect call — a mid-goal registry change can never widen the surface.
- `cancelled` / `denied` round statuses always end the goal immediately.
- Cancellation: `RunGoalOptions.signal` flows into runPlan → executor;
  shells are killed as a process group (`detached` + `kill(-pid)`), so
  grandchildren (`sleep`, pipelines) cannot outlive a Stop.

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

## Runtime dependencies (normative — golden rule 4 companion)

The frozen runtime set lives in `pnpm-workspace.yaml` `catalog` (single source
of truth; packages declare `catalog:` refs). Sanctioned additions beyond the
original frozen set, each with its owner and justification:

| Dependency     | Owner package                   | Why (and why not an alternative)                                                                                                                                                                                                                                                                                                                                                |
| -------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| image metadata | `@tau/ui`                       | In-house fixed-offset header parser (PNG/JPEG/GIF/WebP; bounded JPEG scan). The `image-size` package was REJECTED: every published version carries unpatched HIGH advisories (ICNS / JXL+HEIF infinite-loop DoS — GHSA-w3rx-r6r6-pgpr, GHSA-5p2g-fcmc-qvqq) that the `pnpm audit --prod` gate refuses. Exotic formats go through the optional sharp pipeline.                   |
| `sharp`        | `@tau/ui` (OPTIONAL dependency) | Decode/convert of non-PNG images (JPEG/WebP/GIF/AVIF/…) for terminal rendering — dynamically imported, NEVER bundled (`neverBundle`), graceful metadata-card degradation when absent. The sanctioned optionalDependencies pattern (as the MCP SDK / dsh-llm). Native module: bundling would break it; absence must never break the CLI.                                         |
| `shiki`        | `@tau/webui` (client)           | Code highlighting in result/explanation markdown — one shared highlighter, dynamic import, progressive in-place upgrade (plain text is a valid final state). Alternatives rejected: highlight.js (theme fidelity vs shiki's TextMate grammars), server-side highlighting (needs server render of user content).                                                                 |
| `@vueuse/core` | `@tau/webui` (client)           | Sanctioned client-utility layer per the maintainer's tech direction — useClipboard/useEventListener/watchDebounced replace hand-rolled equivalents; adopted only where it deletes code, not for its own sake.                                                                                                                                                                   |
| `marked`       | `@tau/markdown`                 | Spec-compliant GFM tokenizer for the shared markdown renderers (ANSI for TUI, per marked's documented lexer API); zero transitive deps. Alternatives rejected: hand-rolled second parser (duplicated escape/edge logic), `markdown-it` (plugin-system weight unneeded). The WebUI HTML path deliberately does NOT use marked — `renderMarkdown` stays escape-first by contract. |

Optional SDKs (dynamic import, never bundled, graceful degradation):
`@modelcontextprotocol/sdk` (`@tau/plugins`), `@deepseek-ai/dsh-llm` (`@tau/ai`).
Any new runtime dependency MUST land here + the catalog in the same PR, with
the alternative considered and rejected in the PR description.

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

| Location                        | Contents                                                                                                                                                              | Why here                                                                                                                                                                                                                                                                       |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **repo root**                   | `AGENTS.md`, `AGENTS/`, `SKILL.md`                                                                                                                                    | AI agent entry + per-subsystem rulebooks (mandatory read chain) + the root dev-tool skill router (top of the SKILL.md read chain)                                                                                                                                              |
| repo root                       | `.claude/skills/*/SKILL.md`                                                                                                                                           | L1 ROOT dev-workflow skills for AI coding agents (tau-build, tau-test, tau-release, tau-docs; tau-skill-new is a thin ROUTER to the tool layer) — cross-cutting workflows + the agent-skill discovery entry; the root `SKILL.md` routes every dev tool to its designated skill |
| repo root                       | `docs/`, `.github/`, `.devcontainer/`, `.gitmessage`                                                                                                                  | human deep dives, CI/PR automation, commit template                                                                                                                                                                                                                            |
| repo root                       | `docs-site/` (workspace member `@tau/docs-site`, private)                                                                                                             | the public documentation site — VitePress, zh (default) + en locales; content decomposed from the product feature map (issue #111); authoring workflow: `.claude/skills/tau-docs`; NOT part of the `pnpm build` gate — build explicitly with `pnpm docs:build`                 |
| repo root                       | `package.json`, `pnpm-workspace.yaml` (catalog), `tsdown.config.ts`, `vitest.config.ts`, `tsconfig.json`                                                              | workspace-wide tooling; dependency versions live ONLY in the catalog                                                                                                                                                                                                           |
| **`packages/skills/`**          | `bundled/<name>/SKILL.md`                                                                                                                                             | L3 PRODUCT CONTENT: user-facing skills that SHIP with the CLI — resolved at runtime via `packageRoot()` (moving them breaks `tau skill list`); runtime DATA for the product, not agent skills                                                                                  |
| `packages/<pkg>/`, `app/<app>/` | `SKILL.md` (today: `packages/skills/SKILL.md` — `tau-skills-authoring`; `packages/tools/SKILL.md` — `tau-tools-authoring`; `app/webui/SKILL.md` — `tau-webui-design`) | L2 TOOL layer: package/app-owned agent skills, versioned WITH what they govern; discovered via the AGENTS.md read chain, NOT Claude Code root discovery — add one here when knowledge is bound to a single package or app                                                      |
| `packages/skills/`              | `templates/skill-template/`                                                                                                                                           | L3 PRODUCT CONTENT: scaffold source for `tau skill new` — read at RUNTIME; keep in `ignorePatterns` of oxfmt (`{{placeholders}}` must survive) and in package `files`                                                                                                          |
| repo root                       | `changelog/YYYY-MM-DD.md`                                                                                                                                             | daily AI work logs (AGENTS/collaboration.md §8); `CHANGELOG.md` is distilled from them at release                                                                                                                                                                              |
| repo root                       | `scripts/screenshot/`                                                                                                                                                 | run-screenshot tooling (zero-dep `term-svg.mjs` pty→SVG renderer); committed captures live at `app/<app>/docs/screenshots/` with per-app regeneration docs                                                                                                                     |
| **runtime `$TAU_HOME/`**        | `skills/<name>/` (user scope), `config.json`, `history.jsonl`                                                                                                         | never committed; tests override `TAU_HOME`                                                                                                                                                                                                                                     |
| runtime workspace               | `./skills/`, `./.tau/skills/`                                                                                                                                         | workspace-scope skills of the _user's_ project — never Tau's own skills                                                                                                                                                                                                        |

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
