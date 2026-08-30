# Tau

**AI-powered unified terminal assistant — natural language in, safe commands out.**

[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](tsconfig.json)
[![Tests](https://img.shields.io/badge/tests-147%20passing-success)](vitest.config.ts)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)
[![中文文档](https://img.shields.io/badge/docs-中文-red)](README.zh-CN.md)

Tau turns plain-language intent (English or Chinese) into a **reviewed, confirmed,
executed plan**. It unifies everyday terminal work — files, system, network, text —
behind one command, and makes every AI-proposed action pass a deterministic safety
gate before it can touch your machine.

```bash
tau ask "找出所有 TODO 的地方"          # intent -> plan -> confirm -> done
tau ask "how much disk is left?" --yes  # auto-approve low/medium risk only
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

| Area          | What you get                                                                       |
| ------------- | ---------------------------------------------------------------------------------- |
| `tau ask`     | NL intent → provider plan → safety review → confirm UI → execution → history       |
| `tau file`    | glob find (prunes node_modules), tree, stat, regex batch rename (dry-run default)  |
| `tau sys`     | OS/CPU/memory info, disk usage, top processes                                      |
| `tau net`     | TCP port check, ping, SSRF-guarded fetch, local IPs                                |
| `tau text`    | regex search, project-wide replace (dry-run default), line/word stats              |
| `tau skill`   | SKILL.md command packs: list/show/new/validate                                     |
| `tau plugin`  | MCP servers as tool sources: dsh, VS Code, filesystem, ... (list/add/remove/tools) |
| `tau history` | everything runs are recorded; inspect, replay, clear                               |
| `tau alias`   | persistent command aliases (`tau ll` → anything)                                   |
| `tau config`  | provider, timeout, risk policy — stored under `$TAU_HOME`                          |

## Install

```bash
git clone https://github.com/Z-Yun-H/Tau.git
cd tau && npm install && npm run build && npm link   # provides the `tau` binary
```

Requires Node.js ≥ 20.

## Quick start

```bash
# 1. Works offline out of the box (mock provider)
tau ask "find all ts files"

# 2. Point it at a real model
tau config set provider openai          # + export OPENAI_API_KEY=...
tau config set provider deepseek        # + export DEEPSEEK_API_KEY=...
tau config set provider ollama          # local models, no key needed
tau config set provider zai             # optional z-ai-web-dev-sdk

# 3. Tools you'll actually use
tau sys info
tau net port 3000 --host localhost
tau text search "TODO" --glob "*.ts"
tau file rename " IMG_([0-9]+)" " -photo-$1"     # dry run first
tau file rename " IMG_([0-9]+)" " -photo-$1" -e  # then apply
```

## The safety model in 30 seconds

```
intent ──► provider.plan() ──► validatePlanResponse() ──► reviewPlan() ──┬─► deny    (exit 2, nothing ran)
                                       strict JSON               │       ├─► review (high risk: interactive confirm,
                                       zod schema               DENY     │        --yes never auto-runs these)
                                                               LIST     └─► allow  (low risk: run / --yes)
```

- **Deny list**: `sudo`, `rm -rf /`, `curl | sh`, `dd of=/dev/*`, fork bombs,
  force-pushes, `DROP TABLE`, ... → plan refused before confirmation.
- **Caution list**: `rm`, `chmod`, `kill`, `git reset --hard`, ... → high risk,
  interactive confirmation mandatory.
- **--yes is honest**: it auto-approves low (and optionally medium with
  `config allowMediumAutoApprove true`) — never high, never blocked.
- Full policy & rationale: [docs/safety.md](docs/safety.md).

## AI providers

| Provider         | Needs                       | Setup                                                                            |
| ---------------- | --------------------------- | -------------------------------------------------------------------------------- |
| `mock` (default) | nothing                     | works offline, keyword-matched demo plans                                        |
| `ollama`         | local ollama                | `ollama serve`, config: `providers.ollama.model`                                 |
| `openai`         | `OPENAI_API_KEY`            | any OpenAI-compatible base URL via `providers.openai.baseUrl`                    |
| `deepseek`       | `DEEPSEEK_API_KEY`          | official streaming wire format; model/baseUrl/timeoutMs via `providers.deepseek` |
| `zai`            | optional `z-ai-web-dev-sdk` | graceful "unavailable + how to fix" when missing                                 |

Selection precedence: `--provider` flag > `TAU_PROVIDER` env > `config.provider`.
Unknown → safe fallback to `mock`.

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

Bundled examples: [`skills/git-helper`](skills/git-helper/SKILL.md),
[`skills/docker-helper`](skills/docker-helper/SKILL.md).
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
- **[`AGENTS.d/`](AGENTS.d/)** — per-subsystem rulebooks: [architecture](AGENTS.d/architecture.md),
  [conventions](AGENTS.d/conventions.md), [testing](AGENTS.d/testing.md),
  [skills](AGENTS.d/skills.md), [plugins](AGENTS.d/plugins.md),
  [ai-integration](AGENTS.d/ai-integration.md), [release](AGENTS.d/release.md)
- **[`.claude/skills/`](.claude/skills)** — dev-workflow skills (tau-build, tau-test, tau-release, tau-skill-new)
- **`CLAUDE.md`** pointer for Claude Code; deterministic safety module with 1:1 test coverage
- 147 tests, strict TypeScript, `npm run lint && npm run typecheck && npm test` as the agent gate

## Project layout

```
src/
  index.ts        CLI entry (commander)      core/      session pipeline, safety, executor
  ai/             providers + prompt + plan schema      tools/     registry + file/sys/net/text
  plugins/        MCP client + plugin manager           skills/    SKILL.md loader + manager
  config/         TAU_HOME, config, history             cli/       per-family command wiring
  ui/             theme + confirm
skills/           bundled skills                        templates/ `tau skill new` scaffold
tests/            unit + integration (vitest)           AGENTS.d/  agent rulebooks
```

## Documentation

- [Architecture deep-dive](docs/architecture.md) — pipeline diagram, invariants, how to add a tool/provider
- [Safety model](docs/safety.md) — deny/caution lists, risk semantics, why there is no delete tool
- [Skill authoring](docs/skills-authoring.md) — frontmatter contract, examples, validation
- [MCP plugins](docs/plugins.md) — connect dsh / VS Code / any MCP server, security model
- [中文文档](README.zh-CN.md)

## Contributing

PRs welcome — start with [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md).
The pre-PR gate: `npm run lint && npm run typecheck && npm run test:cov`.

## License

[MIT](LICENSE) © 2026 ZHYun
