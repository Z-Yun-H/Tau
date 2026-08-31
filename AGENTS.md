# AGENTS.md — Tau

**Read this first.** This file is the entry point for AI coding agents
(Claude Code, Codex, Cursor, Copilot Workspace, ...) working on the Tau
repository. Humans are welcome too — it doubles as the fastest tour of the
codebase.

> **MANDATORY for AI agents:** besides this file, read
> [`AGENTS/collaboration.md`](./AGENTS/collaboration.md) — the AI
> collaboration operating norms (issue→PR flow, AI labeling, changelog
> fragments, merge policy). It is binding; violating it is a process
> failure even when the code itself is correct.

> Detailed rulebooks live in [`AGENTS/`](./AGENTS/). The split:
> this file = what you must know in 60 seconds; AGENTS = what you need when
> you actually touch a subsystem.

## What is Tau

Tau is an **AI-powered unified terminal assistant**: natural language in,
safe commands out. One `tau` binary with:

- `tau ask "<intent>"` — AI provider drafts a JSON plan → deterministic safety
  review → interactive confirmation → execution → history
- `tau file | sys | net | text` — built-in tool modules (dual-use: human CLI +
  the catalog the AI planner plans against)
- `tau skill` — SKILL.md command packs (bundled / user / workspace scopes)
- `tau plugin` — MCP servers as tool sources (dsh, VS Code, filesystem, ...)
- `tau tui` / `tau-tui` — interactive terminal session over the same pipeline
- `tau web` / `tau-web` — localhost web UI over the same pipeline
- `tau history | alias | config` — session memory and configuration

Non-goals: shell replacement, remote/network-exposed daemon, secret management.
(The TUI and WebUI are front doors into the same reviewed pipeline, not
independent execution paths.)

## Golden rules for agents

1. **The safety reviewer is sacred.** Never weaken
   `packages/engine/src/safety.ts` (deny list, risk escalation, step caps)
   to make a feature easier. If a test around it fails, fix the feature, not
   the reviewer.
2. **The AI never grades itself.** Any code path that executes an AI-generated
   plan must go through `runPlan()` in `packages/engine/src/session.ts`.
   No bypasses.
3. **Dry-run by default** for anything that mutates (`file.rename`,
   `text.replace`). `execute:true` is always an explicit, visible choice.
4. **No new runtime dependencies** without updating AGENTS/architecture.md
   and justifying it in the PR description. Runtime deps live in the package
   that actually imports them: commander (`@tau/cli`/`@tau/tui`), chalk
   (`@tau/ui`), yaml+zod (`@tau/skills`), zod (`@tau/ai`). The only sanctioned
   exceptions are optionalDependencies (the MCP SDK `@modelcontextprotocol/sdk`
   for plugins and the DeepSeek Harness seam `@deepseek-ai/dsh-llm` for the
   deepseek provider; other provider SDKs stay out of package.json entirely) —
   they must be dynamically imported, never bundled, and the app must degrade
   gracefully when they are absent.
5. **Bilingual docs**: user-facing README changes go to both README.md
   (English) and README.zh-CN.md (Chinese). AGENTS.md/AGENTS stay English.
6. **Workspace hygiene**: packages import each other only through the declared
   `@tau/*` `workspace:*` dependencies (never relative paths across packages,
   never deep imports like `@tau/core/src/...`). Every package's public API is
   its `src/index.ts` barrel. Vitest aliases `@tau/*` to source; runtime uses
   each package's dist after `pnpm build`.
7. **Run the gates before you claim done:**
   `pnpm lint && pnpm typecheck && pnpm test`

## Command map

| Task                  | Command                                                       |
| --------------------- | ------------------------------------------------------------- |
| Install               | `pnpm install`                                                |
| Run from source       | `pnpm dev -- <args>` (e.g. `pnpm dev -- file find "*.ts"`)    |
| Run TUI / WebUI (dev) | `pnpm --filter @tau/tui dev` / `pnpm --filter @tau/webui dev` |
| Type check            | `pnpm typecheck`                                              |
| Lint + autofix        | `pnpm lint:fix`                                               |
| Format                | `pnpm format`                                                 |
| Tests (watch)         | `pnpm test:watch`                                             |
| Tests (CI) + coverage | `pnpm test:cov`                                               |
| Build all packages    | `pnpm build` (unified tsdown workspace build)                 |
| Full pre-PR gate      | `pnpm lint && pnpm typecheck && pnpm test:cov`                |

## Repo map — pnpm monorepo

```
app/                        UI layer (thin front doors, no engine logic)
  cli/src/index.ts          bin `tau`: builds commander program, registers tools+skills
  cli/src/<family>.ts       thin commander wiring per command family (ask, file, sys, ...)
  tui/src/index.ts          bin `tau-tui`: interactive REPL (slash commands + intents)
  webui/src/server.ts       zero-dependency HTTP API over the engine + static UI
packages/                   engine layer (each with a public src/index.ts barrel)
  core/src/types.ts         shared domain vocabulary (Plan, ToolDefinition, RiskLevel...)
  core/src/config/          TAU_HOME paths, config store, JSONL history
  engine/src/               session pipeline (runPlan), safety reviewer, executor
  ai/src/                   provider registry + prompt builder + plan schema + models
  ai/src/providers/         mock | ollama | openai | deepseek | zai
  tools/src/                registry + file/sys/net/text tool modules (+ bootstrap.ts)
  plugins/src/              MCP client seam, plugin manager, tool registration
  skills/src/               SKILL.md loader, schema, manager + bundled asset paths
  skills/bundled/           bundled skills (git-helper, docker-helper)
  skills/templates/         `tau skill new` scaffold source
  agent/src/                catalog prep + intent->plan pipeline shared by all UIs
  ui/src/                   chalk theme, confirm prompt, list picker
tests                       live INSIDE each package: <pkg>/tests/*.test.ts
AGENTS/                     deep-dive rulebooks for agents (see below)
docs/                       human-facing deep dives (architecture, safety, skills, plugins)
```

## AGENTS index — read the relevant file BEFORE touching that subsystem

| File                                                   | Read it when...                                                 |
| ------------------------------------------------------ | --------------------------------------------------------------- |
| [AGENTS/collaboration.md](./AGENTS/collaboration.md)   | **always — AI collaboration norms (mandatory, normative)**      |
| [AGENTS/architecture.md](./AGENTS/architecture.md)     | you add/modify any module, command, or the plan pipeline        |
| [AGENTS/conventions.md](./AGENTS/conventions.md)       | you write any TypeScript in this repo                           |
| [AGENTS/testing.md](./AGENTS/testing.md)               | you write or run tests                                          |
| [AGENTS/skills.md](./AGENTS/skills.md)                 | you touch skills/, templates/, or the SKILL.md parser           |
| [AGENTS/plugins.md](./AGENTS/plugins.md)               | you touch packages/plugins/src/, MCP integration, or plugin CLI |
| [AGENTS/ai-integration.md](./AGENTS/ai-integration.md) | you touch packages/ai/src/, safety, or provider code            |
| [AGENTS/release.md](./AGENTS/release.md)               | you cut a release or bump versions                              |

## Change checklist (every PR)

- [ ] `pnpm lint && pnpm typecheck && pnpm test` green
- [ ] New behavior has tests (see AGENTS/testing.md for patterns)
- [ ] New user-facing flags/commands documented in both READMEs
- [ ] Tool added? → registered in `packages/tools/src/<module>.ts`,
      catalog renders, risk level reviewed, docs table updated
- [ ] Skill-related change? → AGENTS/skills.md checklist
- [ ] Plugin-related change? → AGENTS/plugins.md checklist
- [ ] `docs/safety.md` still truthful after your change
- [ ] CHANGELOG.md entry under **Unreleased**
- [ ] AI-authored? → PR body notes "此 PR 由 AI 生成"；every AI commit carries
      the `AI-Generated:` prefix line AND the `AI-declaration:` block,
      presented to the human BEFORE committing (AGENTS/collaboration.md,
      AGENTS/release.md)
- [ ] PR title tagged `[REFACTOR]` / `[ARCHITECTURE]` when applicable; AI
      never merges — human review required

## Commit style

Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`,
`chore:`. Scope optional: `feat(ask): support streaming plans`.

## When unsure

- Prefer the boring solution.
- Prefer read-only tools over shell.
- Prefer asking in the PR over guessing silently.
