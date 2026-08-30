# AGENTS/architecture.md — module map & data flow

Owner of truth for how data moves. Update this file whenever you change the
pipeline, add a command family, or add a module.

## The one diagram that matters

```
                 ┌────────────────────────────────────────────────────┐
 user intent ──► │ tau ask (src/cli/ask.ts)                           │
                 │   1. resolveProvider()      src/ai/registry.ts     │
                 │   2. planningContext()      src/ai/prompt.ts       │
                 │      ├─ registerPluginTools()  src/plugins/runtime │
                 │      │    (MCP discovery; failures → warnings)     │
                 │      ├─ tool catalog  ←─ src/tools/registry.ts     │
                 │      └─ skill catalog ←─ src/skills/loader.ts      │
                 │   3. provider.plan()        ai/providers/*         │
                 │      └─ validatePlanResponse()  zod, STRICT JSON   │
                 │   4. runPlan()              src/core/session.ts    │
                 │      ├─ reviewPlan()        src/core/safety.ts     │
                 │      │    deny / review / allow                    │
                 │      ├─ confirm UI          src/ui/confirm.ts      │
                 │      ├─ executeStep()       src/core/executor.ts   │
                 │      │    tool steps → registry.run               │
                 │      │    shell steps → spawn (shell:true)         │
                 │      └─ appendHistory()     src/config/history.ts  │
                 └────────────────────────────────────────────────────┘

 direct CLI (tau file find ...) ──► runToolDirect() ──► tool.run() ──► history
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

| I want to...                                | Do this                                                                                                                                                                                |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| add a built-in tool op (e.g. `file.dedupe`) | implement in `src/tools/<family>.ts` as ToolDefinition + register in the family array + add CLI wiring in `src/cli/<family>.ts` + tests. Consider dry-run default if it mutates.       |
| add a command family (e.g. `tau pkg`)       | new `src/tools/pkg.ts` + `src/cli/pkg.ts` + register both in `src/index.ts buildProgram()` + update this file + both READMEs                                                           |
| add an AI provider                          | implement AIProvider in `src/ai/providers/<name>.ts` + register in `src/ai/registry.ts` + config defaults in `src/config/store.ts DEFAULT_CONFIG.providers` + AGENTS/ai-integration.md |
| integrate an external tool server (MCP)     | nothing to code — `tau plugin add`; changing the MCP layer itself → `src/plugins/*` + AGENTS/plugins.md (plugin tools are ALWAYS medium risk)                                          |
| add a bundled skill                         | new dir `skills/<name>/SKILL.md` (spec: AGENTS/skills.md) — no TS code required for declarative commands                                                                               |
| change the plan schema                      | `src/ai/prompt.ts planSchema` + safety reviewer expectations + tests + this diagram                                                                                                    |
| change config keys                          | `src/types.ts TauConfig` + `src/config/store.ts` (defaults + VALID_KEYS) + READMEs                                                                                                     |
| add model discovery to a provider           | optional `listModels()` on the provider (throw on failure) + `src/ai/models.ts` handles caching; UI via `tau provider` (src/cli/provider.ts); contract in AGENTS/ai-integration.md     |

## Runtime data layout ($TAU_HOME, default ~/.tau)

```
$TAU_HOME/
  config.json      TauConfig (provider, timeout, aliases, plugins[], providers.*)
                   — may hold providers.<name>.apiKey; chmod 0600, keys masked in CLI output
  history.jsonl    append-only HistoryEntry per line
  skills/<name>/   user skills (highest precedence for name conflicts)
```

`TAU_HOME` env var overrides everything — tests rely on this. Never read
`~/.tau` directly; always go through `src/config/paths.ts`.

## Key type glossary (src/types.ts is the source)

- `PlanStep` — one action: `tool` (registry lookup) or `shell` (reviewed spawn)
- `Plan` — explanation + steps; what providers return and runPlan executes
- `SafetyReview` — verdict allow/review/deny + issues; from reviewPlan()
- `ToolDefinition` — name/description/params/risk/run; dual-use unit
- `PluginConfig` — one MCP server (transport stdio|http, endpoint, env/headers)
- `ModelInfo` — one discovered model id (+owner); served by `src/ai/models.ts`
- `SkillMeta` — parsed SKILL.md frontmatter
- `RiskLevel` — low < medium < high < blocked (RISK_ORDER)
