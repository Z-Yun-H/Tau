# Tau

**AI-powered unified terminal assistant — natural language in, safe commands out.**

[![CI](https://github.com/Z-Yun-H/Tau/actions/workflows/ci.yml/badge.svg)](https://github.com/Z-Yun-H/Tau/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](tsconfig.json)
[![Tests](https://img.shields.io/badge/tests-667%20passing-success)](vitest.config.ts)
[![pnpm](https://img.shields.io/badge/pnpm-monorepo-F69220)](pnpm-workspace.yaml)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)
[![中文文档](https://img.shields.io/badge/docs-中文-red)](README.zh-CN.md)

Tau turns plain-language intent (English or Chinese) into a **reviewed, confirmed,
executed plan**. It unifies everyday terminal work — files, system, network, text —
behind one command, and makes every AI-proposed action pass a deterministic safety
gate before it can touch your machine.

```bash
tau ask "找出所有 TODO 的地方"          # intent -> plan -> confirm -> done
tau ask "how much disk is left?" --yes  # auto-approve low risk (medium only with allowMediumAutoApprove)
tau goal "migrate the config format"    # multi-round agent loop: plan -> run -> reflect -> repeat
tau file find "*.ts"                    # or use the tools directly
```

---

## Why Tau

Every AI-terminal tool trusts the model and _hopes_. Tau is built the other way
around: **the AI proposes, deterministic code disposes.**

- **Plans, not vibes** — the model must answer strict JSON (zod-validated);
  garbage never reaches your shell.
- **The AI never grades itself** — a tested, deterministic SafetyReviewer
  (deny list + risk levels + step caps) stands between every plan and execution.
- **Dry-run by default** — anything that mutates (`file.rename`, `text.replace`)
  previews first; applying changes is always an explicit flag.
- **No delete primitive** — Tau's first-party tools cannot delete; destructive
  shell steps go through deny-list scan + interactive confirmation or they don't run.
- **Offline-first** — with no API key, `tau` is still a full toolbox with the
  bundled `mock` provider.

## Features

| Area           | What you get                                                                                                                                                                                                                                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tau ask`      | NL intent → provider plan → safety review → confirm UI → execution → history (v0.5.0: the WebUI shows the provider's thinking live while it plans)                                                                                                                                          |
| `tau goal`     | multi-round agent loop: plan → run → reflect → repeat (round cap, per-round safety review, same confirmation gates)                                                                                                                                                                         |
| `tau file`     | glob find (prunes node_modules), tree, stat, line-numbered read (offset/limit), dir list, regex batch rename (dry-run default), text write (workspace-contained, dry-run default)                                                                                                           |
| `tau sys`      | OS/CPU/memory info, disk usage, top processes, datetime (local/ISO/epoch/tz), which, env lookup (one name, medium risk)                                                                                                                                                                     |
| `tau net`      | TCP port check, ping, SSRF-guarded fetch, local IPs                                                                                                                                                                                                                                         |
| `tau text`     | regex search, project-wide replace (dry-run default), line/word stats, sha256/sha1 hash                                                                                                                                                                                                     |
| `tau skill`    | SKILL.md command packs: list/show/new/validate                                                                                                                                                                                                                                              |
| `tau plugin`   | MCP servers as tool sources: dsh, VS Code, filesystem, ... (list/add/remove/tools)                                                                                                                                                                                                          |
| `tau history`  | everything runs are recorded; inspect, replay, clear                                                                                                                                                                                                                                        |
| `tau alias`    | persistent command aliases (`tau ll` → anything)                                                                                                                                                                                                                                            |
| `tau provider` | API keys + live model discovery: set a key, models auto-refresh, pick interactively                                                                                                                                                                                                         |
| `tau config`   | provider, timeout, risk policy — stored under `$TAU_HOME`                                                                                                                                                                                                                                   |
| `tau tui`      | fullscreen keyboard-first REPL (v0.6.0: `/` opens a filterable command palette fed by the shared command catalog — shown can never drift from what runs)                                                                                                                                    |
| `tau web`      | local web interface (v0.6.0: composer `/` command menu, conversation threads, image attachments with server-side magic-number validation, sandboxed HTML previews + native PDF/image viewing; v0.6.1: settings provider setup — model link lookup, paste-only API key with privacy masking) |

## Install

```bash
git clone https://github.com/Z-Yun-H/Tau.git
cd tau && pnpm install && pnpm build
cd app/cli && pnpm link --global   # provides the `tau` binary (run `pnpm setup` once first if pnpm's global bin dir is not on your PATH)
```

Requires Node.js ≥ 20 and pnpm ≥ 10 (corepack handles it: `corepack enable pnpm`).

## Screenshots

Real runs — the CLI/TUI captures are pty recordings rendered to SVG, the
WebUI shots come from the actual server + client in headless Chromium (all
offline, mock provider). Regeneration: `app/*/docs/screenshots/README.md`.

<p align="center">
  <img alt="tui plan flow" src="app/tui/docs/screenshots/plan-flow.svg" width="49%">
  <img alt="tui markdown" src="app/tui/docs/screenshots/markdown.svg" width="49%">
</p>

<p align="center">
  <img alt="webui plan (dark)" src="app/webui/docs/screenshots/plan.png" width="32%">
  <img alt="webui result (dark)" src="app/webui/docs/screenshots/result.png" width="32%">
  <img alt="webui agent mode (dark)" src="app/webui/docs/screenshots/agent.png" width="32%">
</p>

## Quick start

```bash
# 1. Works offline out of the box (mock provider)
tau ask "find all ts files"

# 2. Point it at a real model — the key unlocks a live model catalog
tau provider set-key deepseek sk-...     # stores the key (config, chmod 600)
                                         # -> model catalog auto-refreshes
tau provider use deepseek                # pick a model from the refreshed list
tau provider models deepseek             # or just browse it

# Prefer env vars? They still work as fallback:
tau config set provider openai           # + export OPENAI_API_KEY=...
tau config set provider ollama           # local models, no key needed
tau config set provider zai              # optional z-ai-web-dev-sdk

# 3. Tools you'll actually use
tau sys info
tau net port 3000 --host localhost
tau text search "TODO" --glob "*.ts"
tau file rename " IMG_([0-9]+)" " -photo-$1"     # dry run first
tau file rename " IMG_([0-9]+)" " -photo-$1" -e  # then apply
```

**PowerShell users**: plan shell-steps run through your shell —
`tau config set shell pwsh` forces an explicit non-profile, non-interactive
PowerShell invocation with exit-code propagation (`bash` works too; the
`auto` default picks pwsh automatically on Windows when it is on PATH and
leaves POSIX untouched).

## The safety model in 30 seconds

```
intent ──► provider.plan() ──► validatePlanResponse() ──► reviewPlan() ──┬─► deny    (exit 2, nothing ran)
                                       strict JSON               │       ├─► review (high risk: interactive confirm,
                                       zod schema               DENY     │        --yes never auto-runs these)
                                                               LIST     └─► allow  (low risk: run / --yes)
```

- **Deny list**: `sudo`, `rm -rf /`, `curl | sh`, `dd of=/dev/*`, fork bombs,
  force-pushes, `DROP TABLE`, ... → plan refused before confirmation.
- **Caution list**: `rm`, `chmod`, `kill`, `git reset --hard`, PowerShell
  destructives (`Remove-Item -Recurse`, `Format-Volume`,
  `Set-ExecutionPolicy`, `Invoke-Expression`), ... → high risk, interactive
  confirmation mandatory.
- **--yes is honest**: it auto-approves low (and optionally medium with
  `config allowMediumAutoApprove true`) — never high, never blocked.
- Full policy & rationale: [docs/safety.md](docs/safety.md).

## AI providers

| Provider         | Needs                       | Setup                                                                                                                                                                      |
| ---------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mock` (default) | nothing                     | works offline, keyword-matched demo plans                                                                                                                                  |
| `ollama`         | local ollama                | `ollama serve`, config: `providers.ollama.model` (+ `providers.ollama.think: true` requests thinking where the model supports it)                                          |
| `openai`         | `OPENAI_API_KEY`            | any OpenAI-compatible base URL via `providers.openai.baseUrl` — streaming planner aware of `reasoning_content` (DeepSeek-R1/GLM-style thinking over OpenAI endpoints)      |
| `deepseek`       | `DEEPSEEK_API_KEY`          | DeepSeek Harness adapter (`@deepseek-ai/dsh-llm`): official streaming wire format, `LlmAdapter` + `StreamChunk` protocol; model/baseUrl/timeoutMs via `providers.deepseek` |
| `zai`            | optional `z-ai-web-dev-sdk` | graceful "unavailable + how to fix" when missing                                                                                                                           |
| `anthropic`      | `ANTHROPIC_API_KEY`         | Claude Messages API: streaming, `/v1/models` discovery, extended thinking via `providers.anthropic.thinking` (+ optional `thinkingBudget`)                                 |
| `gemini`         | `GOOGLE_API_KEY`            | Google Gemini REST: JSON mode (`responseMimeType`), 2.5-series thought deltas as thinking, optional `providers.gemini.thinkingBudget`                                      |

All real providers stream (`planStream`): thinking deltas arrive separately
from plan text and are surfaced in the WebUI while the same
`validatePlanResponse` gate stays authoritative. Selection precedence:
`--provider` flag > `TAU_PROVIDER` env > `config.provider`.
Unknown → safe fallback to `mock`.

API keys resolve in the order **config (`providers.<name>.apiKey`) → environment
variable** — so `tau provider set-key` sticks even when an env var is exported
for other tools, and CI setups can keep using env-only.

### Model selection: keys refresh the catalog

Providers expose live model discovery (`GET /models` for openai/deepseek,
`/api/tags` for ollama). As soon as a key is configured, Tau fetches the
catalog, caches it (`providers.<name>.availableModels`, 24 h TTL) and serves
model choices from it:

```bash
tau provider list                        # key source, active model, cache age
tau provider set-key deepseek sk-...     # stores key -> auto-refreshes catalog
tau provider models [--refresh|--offline]
tau provider use deepseek [model]        # interactive arrow-key picker on a TTY
```

Tau ships **no hardcoded default models** — a model always comes from this
live catalog or your explicit config. When the catalog offers exactly one
model, Tau auto-selects it and persists the choice; with several, `tau ask`
fails fast with an actionable hint instead of guessing, so pick one with
`tau provider use`.

Catalog display never leaks keys, a failed refresh degrades to the cached
list, and providers without discovery (zai) require an explicit
`providers.<name>.model`.

## Skills: teach Tau new tricks with one markdown file

Drop a `SKILL.md` into `~/.tau/skills/<name>/` or your project's `skills/`:

```markdown
---
name: git-helper
version: 0.1.0
description: Read-only git workflow shortcuts
risk: low
triggers: [git, commit, branch]
commands:
  - name: status
    description: Show working tree status
    command: git status --short --branch
---

Usage docs here — humans AND the AI planner read this.
```

```bash
tau skill list                 # bundled + user + workspace scopes
tau skill new my-skill "..."   # scaffold from template into ~/.tau/skills
tau skill validate my-skill    # frontmatter + deny-list scan
tau git-helper status          # declarative commands become CLI + AI-callable tools
```

Bundled examples: [`packages/skills/bundled/git-helper`](packages/skills/bundled/git-helper/SKILL.md),
[`packages/skills/bundled/docker-helper`](packages/skills/bundled/docker-helper/SKILL.md).
Authoring guide: [docs/skills-authoring.md](docs/skills-authoring.md).

## Plugins: drive external tools over MCP

Skills add _commands_ to Tau; **plugins add _tool servers_**. Tau speaks the
[Model Context Protocol](https://modelcontextprotocol.io) (MCP), so any MCP
server — the [DeepSeek Harness (`dsh`)](https://github.com/deepseek-ai/deepseek-harness),
VS Code bridges, filesystem/GitHub/database servers — plugs into the same
plan → review → confirm pipeline as built-in tools:

```bash
tau plugin add files -- npx -y @modelcontextprotocol/server-filesystem ./project
tau plugin add dsh --url http://127.0.0.1:8787/mcp     # http transport
tau plugin list                                          # what is configured
tau plugin tools files                                   # live discovery check

# tools appear in the AI catalog as plugin.files.list_directory [risk:medium]
tau ask "在项目里找所有超过 1MB 的文件"
```

Plugin tools are **always medium risk** (interactive confirm; `--yes` honors
`allowMediumAutoApprove`) — third-party capabilities never ride the fast
path. transports: `stdio` (spawn a local server) and `http` (Streamable HTTP
endpoint). Guide + recipes: [docs/plugins.md](docs/plugins.md).

## AI-friendly by construction

Tau is designed to be _maintained by AI agents_ as much as used by humans:

- **[`AGENTS.md`](AGENTS.md)** — 60-second orientation + golden rules + pre-PR gate
- **[`AGENTS/`](AGENTS/)** — per-subsystem rulebooks: [architecture](AGENTS/architecture.md),
  [conventions](AGENTS/conventions.md), [testing](AGENTS/testing.md),
  [skills](AGENTS/skills.md), [plugins](AGENTS/plugins.md),
  [ai-integration](AGENTS/ai-integration.md), [release](AGENTS/release.md)
- **[`.claude/skills/`](.claude/skills)** — root dev-workflow skills (tau-dev, tau-build, tau-test, tau-release, plus the tau-skill-new / tau-tool-new routers), routed per dev tool by the root [`SKILL.md`](SKILL.md); package/app-bound tool skills live at `packages/<pkg>/SKILL.md` and `app/<app>/SKILL.md` (e.g. [`packages/skills/SKILL.md`](packages/skills/SKILL.md), [`packages/tools/SKILL.md`](packages/tools/SKILL.md), [`app/webui/SKILL.md`](app/webui/SKILL.md))
- **`CLAUDE.md`** pointer for Claude Code; deterministic safety module with 1:1 test coverage
- 274 tests, strict TypeScript, `pnpm lint && pnpm typecheck && pnpm test` as the agent gate

## Project layout — pnpm monorepo

UI apps live in `app/`, the reusable engine in `packages/`. Every workspace
package is versioned, built with tsdown, and consumed through `workspace:*`
dependencies; the CLI (`@tau/cli`) bundles nothing from its siblings — the
workspace resolves them at runtime. Every package and app ships its own
`README.md` describing its public API, dependencies and dev commands.

```
app/
  cli/            @tau/cli    — bin `tau`: commander app + `tau tui` / `tau web` bridges
  tui/            @tau/tui    — bin `tau-tui`: interactive REPL (markdown & image previews: /md, /view)
  webui/          @tau/webui  — bin `tau-web`: local web interface (Vue 3 + UnoCSS client, light/dark themes, plan mode + multi-round agent mode, zero-dependency node API)
packages/
  core/           @tau/core    — types, config store, history, TAU_HOME paths
  tools/          @tau/tools   — registry + file/sys/net/text tools
  engine/         @tau/engine  — safety review, executor, runPlan (only execution channel)
  ai/             @tau/ai      — providers (mock/ollama/openai/deepseek/zai), prompt, models
  skills/         @tau/skills  — SKILL.md schema/loader/manager + bundled skills & templates
  plugins/        @tau/plugins — MCP plugin system
  agent/          @tau/agent   — orchestration shared by all UIs (catalog + intent→plan)
  ui/             @tau/ui      — theme, confirm, picker (terminal primitives)
SKILL.md          root dev-tool skill router   AGENTS/  agent rulebooks
docs/             deep dives                   changelog/  daily AI work logs
```

Dependency direction (enforced by package boundaries): `core ← tools ← engine`,
`core+engine+ui ← skills`, `core+tools ← ai|plugins`, everything above ← `agent`,
and apps depend on all of them. No cycles — including at test time.

## Documentation

- **[Documentation site](docs/)** — bilingual VitePress site (zh default, en under `/en/`), one page per feature; `pnpm docs:dev` to browse locally, `pnpm docs:build` to build
- [Architecture deep-dive](docs/architecture.md) — pipeline diagram, invariants, how to add a tool/provider
- [Safety model](docs/safety.md) — deny/caution lists, risk semantics, why there is no delete tool
- [Skill authoring](docs/skills-authoring.md) — frontmatter contract, examples, validation
- [MCP plugins](docs/plugins.md) — connect dsh / VS Code / any MCP server, security model
- [中文文档](README.zh-CN.md)

## Contributing

PRs welcome — start with [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md).
The pre-PR gate: `pnpm lint && pnpm typecheck && pnpm test:cov`.

## License

[MIT](LICENSE) © 2026 Z-Yun-H
