# AGENTS.md — Tau

**Read this first.** This file is the entry point for AI coding agents
(Claude Code, Codex, Cursor, Copilot Workspace, ...) working on the Tau
repository. Humans are welcome too — it doubles as the fastest tour of the
codebase.

> Detailed rulebooks live in [`AGENTS.d/`](./AGENTS.d/). The split:
> this file = what you must know in 60 seconds; AGENTS.d = what you need when
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
- `tau history | alias | config` — session memory and configuration

Non-goals: shell replacement, TUI dashboard, daemon/server, secret management.

## Golden rules for agents

1. **The safety reviewer is sacred.** Never weaken `src/core/safety.ts`
   (deny list, risk escalation, step caps) to make a feature easier. If a test
   around it fails, fix the feature, not the reviewer.
2. **The AI never grades itself.** Any code path that executes an AI-generated
   plan must go through `runPlan()` in `src/core/session.ts`. No bypasses.
3. **Dry-run by default** for anything that mutates (`file.rename`,
   `text.replace`). `execute:true` is always an explicit, visible choice.
4. **No new runtime dependencies** without updating AGENTS.d/architecture.md
   and justifying it in the PR description. Current runtime deps: commander,
   chalk, yaml, zod. The only sanctioned exceptions are optionalDependencies
   (the MCP SDK `@modelcontextprotocol/sdk` for plugins and the DeepSeek
   Harness seam `@deepseek-ai/dsh-llm` for the deepseek provider; other
   provider SDKs stay out of package.json entirely) — they must be dynamically
   imported, never bundled, and the CLI must degrade gracefully when they are
   absent.
5. **Bilingual docs**: user-facing README changes go to both README.md
   (English) and README.zh-CN.md (Chinese). AGENTS.md/AGENTS.d stay English.
6. **Run the gates before you claim done:**
   `npm run lint && npm run typecheck && npm test`

## Command map

| Task                  | Command                                                          |
| --------------------- | ---------------------------------------------------------------- |
| Install               | `npm install`                                                    |
| Run from source       | `npm run dev -- <args>` (e.g. `npm run dev -- file find "*.ts"`) |
| Type check            | `npm run typecheck`                                              |
| Lint + autofix        | `npm run lint:fix`                                               |
| Format                | `npm run format`                                                 |
| Tests (watch)         | `npm run test:watch`                                             |
| Tests (CI) + coverage | `npm run test:cov`                                               |
| Build dist/           | `npm run build`                                                  |
| Full pre-PR gate      | `npm run lint && npm run typecheck && npm run test:cov`          |

## Repo map

```
src/
  index.ts          CLI entry: builds commander program, registers tools+skills
  types.ts          shared domain vocabulary (Plan, ToolDefinition, RiskLevel...)
  core/             session pipeline, safety reviewer, executor
  ai/               provider registry + prompt builder + plan schema
  ai/providers/     mock | ollama | openai | deepseek | zai
  tools/            registry + file/sys/net/text tool modules
  plugins/          MCP client seam, plugin manager, tool registration
  skills/           SKILL.md loader, schema, manager (list/show/new/validate)
  config/           TAU_HOME paths, config store, JSONL history
  cli/              thin commander wiring per command family
  ui/               chalk theme, confirm prompt
skills/             bundled skills (git-helper, docker-helper)
templates/          tau skill new scaffold source
tests/              vitest unit + CLI integration tests
AGENTS.d/           deep-dive rulebooks for agents (see below)
docs/               human-facing deep dives (architecture, safety, skills, plugins)
```

## AGENTS.d index — read the relevant file BEFORE touching that subsystem

| File                                                       | Read it when...                                          |
| ---------------------------------------------------------- | -------------------------------------------------------- |
| [AGENTS.d/architecture.md](./AGENTS.d/architecture.md)     | you add/modify any module, command, or the plan pipeline |
| [AGENTS.d/conventions.md](./AGENTS.d/conventions.md)       | you write any TypeScript in this repo                    |
| [AGENTS.d/testing.md](./AGENTS.d/testing.md)               | you write or run tests                                   |
| [AGENTS.d/skills.md](./AGENTS.d/skills.md)                 | you touch skills/, templates/, or the SKILL.md parser    |
| [AGENTS.d/plugins.md](./AGENTS.d/plugins.md)               | you touch src/plugins/, MCP integration, or plugin CLI   |
| [AGENTS.d/ai-integration.md](./AGENTS.d/ai-integration.md) | you touch src/ai/, safety, or provider code              |
| [AGENTS.d/release.md](./AGENTS.d/release.md)               | you cut a release or bump versions                       |

## Change checklist (every PR)

- [ ] `npm run lint && npm run typecheck && npm test` green
- [ ] New behavior has tests (see AGENTS.d/testing.md for patterns)
- [ ] New user-facing flags/commands documented in both READMEs
- [ ] Tool added? → registered in `src/tools/<module>.ts`, catalog renders,
      risk level reviewed, docs table updated
- [ ] Skill-related change? → AGENTS.d/skills.md checklist
- [ ] Plugin-related change? → AGENTS.d/plugins.md checklist
- [ ] `docs/safety.md` still truthful after your change
- [ ] CHANGELOG.md entry under **Unreleased**

## Commit style

Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`,
`chore:`. Scope optional: `feat(ask): support streaming plans`.

## When unsure

- Prefer the boring solution.
- Prefer read-only tools over shell.
- Prefer asking in the PR over guessing silently.
