---
name: tau-dev-router
version: 0.1.0
description: Unified root router for Tau's dev-tool skills — build, test, release, skill authoring, WebUI design, CLI tool modules, AI providers, plugins, and the TUI. Use right after AGENTS.md to find the ONE designated skill file and normative spec for whatever subsystem you are about to touch.
author: Tau maintainers
tags: [router, dev-workflow, tau]
risk: low
---

# Tau dev-tool skill router (root)

> **Layer note — this is the ROOT ROUTER, not the content.** It sits at the
> top of the SKILL.md read chain and is versioned with the repo. It is NOT
> runtime data: the tau CLI never loads it (it is not under `bundled/`); AI
> coding agents consume it through the `AGENTS.md` read chain. The
> normative placement model lives in
> [AGENTS/skills.md](./AGENTS/skills.md) ("SKILL.md files in THIS repo —
> three layers"); this router is an index above those layers.

The read chain:

```
AGENTS.md          (rules + 60-second tour — always first)
  └─> SKILL.md     (this file — route by dev tool)
        ├─> .claude/skills/<name>/SKILL.md              L1 dev-workflow skills
        ├─> packages/<pkg>/SKILL.md, app/<app>/SKILL.md L2 tool-layer skills
        └─> AGENTS/<topic>.md                           normative deep dives
```

## Routing table — every dev tool has exactly one designated entry

| Dev tool / task                      | Designated skill                                                                                                                 | Normative spec                                         | Fast path                                                |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------- |
| Dev / run from source                | [.claude/skills/tau-dev](./.claude/skills/tau-dev/SKILL.md)                                                                      | [AGENTS/conventions.md](./AGENTS/conventions.md)       | `pnpm dev -- file find "*.ts"`                           |
| Build / typecheck                    | [.claude/skills/tau-build](./.claude/skills/tau-build/SKILL.md)                                                                  | [AGENTS/architecture.md](./AGENTS/architecture.md)     | `pnpm build`                                             |
| Test / coverage                      | [.claude/skills/tau-test](./.claude/skills/tau-test/SKILL.md)                                                                    | [AGENTS/testing.md](./AGENTS/testing.md)               | `pnpm test:cov`                                          |
| Release / version bump               | [.claude/skills/tau-release](./.claude/skills/tau-release/SKILL.md)                                                              | [AGENTS/release.md](./AGENTS/release.md)               | maintainer checklist, never `pnpm publish` from an agent |
| Create / validate a Tau skill        | [.claude/skills/tau-skill-new](./.claude/skills/tau-skill-new/SKILL.md) → [packages/skills/SKILL.md](./packages/skills/SKILL.md) | [AGENTS/skills.md](./AGENTS/skills.md)                 | `pnpm dev -- skill new <name> "<desc>"`                  |
| WebUI client design                  | [app/webui/SKILL.md](./app/webui/SKILL.md)                                                                                       | [app/webui/README.md](./app/webui/README.md)           | `pnpm --filter @tau/webui dev`                           |
| CLI tool modules (file/sys/net/text) | [.claude/skills/tau-tool-new](./.claude/skills/tau-tool-new/SKILL.md) → [packages/tools/SKILL.md](./packages/tools/SKILL.md)     | [AGENTS/architecture.md](./AGENTS/architecture.md)     | `pnpm dev -- file find "*.ts"`                           |
| AI providers / plan pipeline         | — (AGENTS rulebook governs)                                                                                                      | [AGENTS/ai-integration.md](./AGENTS/ai-integration.md) | `pnpm dev -- ask "find ts files" --yes` (mock)           |
| Documentation site (VitePress)       | [.claude/skills/tau-docs](./.claude/skills/tau-docs/SKILL.md)                                                                    | [AGENTS/architecture.md](./AGENTS/architecture.md)     | `pnpm docs:dev`                                          |
| MCP plugins                          | — (AGENTS rulebook governs)                                                                                                      | [AGENTS/plugins.md](./AGENTS/plugins.md)               | `pnpm dev -- plugin list`                                |
| TUI session                          | — (AGENTS rulebook governs)                                                                                                      | [AGENTS/architecture.md](./AGENTS/architecture.md)     | `pnpm --filter @tau/tui dev`                             |

Rows marked "—" have no dedicated skill yet: their AGENTS rulebook governs.
Add an L1 or L2 skill (and a row here) only when a workflow outgrows the
rulebook — see the maintenance rule below.

## Per-tool essentials (the 15-second version)

The designated skill owns the full workflow; these are the load-bearing
rules to know before you even open it.

- **Dev (run from source)** — `pnpm dev -- <args>` resolves every `@tau/*`
  import to TypeScript via the development export condition (zero build);
  sandbox manual runs with a temp `TAU_HOME`; WebUI in dev is two processes
  (API server + vite client). The designated skill owns the full loop.
- **Build** — gates in order: `typecheck → lint → pnpm build`. The root
  build also builds the two vite apps (`@tau/tui`, `@tau/webui`); every
  produced `dist/index.js` must start with `#!/usr/bin/env node`. Fix
  code on `noUncheckedIndexedAccess` errors — never loosen tsconfig.
- **Test** — tests sandbox `TAU_HOME`; never run the suite with your real
  `~/.tau` in the environment. Coverage thresholds (55/55/55/55) fail the
  build: add tests, do not lower them. No test opens a network socket.
  Results go into the PR body + the commit's `AI-gate:` trailer.
- **Release** — maintainer-run. Gate → changelog (distilled from the daily
  `changelog/` files) → lockstep version bump across the `@tau/*` family →
  build verify → pack smoke test → publish. Never with a dirty tree.
- **Skill authoring** — read the frontmatter contract first. Skills are
  read-only by default; every command runs through the reviewed shell path;
  declare honest `risk`. `bundled/` and `templates/` are PRODUCT CONTENT —
  moving them breaks `tau skill list` / `tau skill new`.
- **WebUI design** — one semantic color system only: risk (via
  `RiskBadge.vue`). No gradients, no glassmorphism, no emoji icons; data in
  mono, prose in sans; three breakpoints (≥1024 / 640–1023 / <640); the
  client stays engine-agnostic (zero runtime `@tau/*` imports).
- **CLI tool modules** — dual-use: human CLI subcommands AND the catalog the
  AI planner plans against. New tool ⇒ define it in
  `packages/tools/src/<module>.ts`, review its risk level, wire the CLI
  family, update the docs table, add tests. Mutators are dry-run by
  default; there are no delete primitives. The full authoring workflow is
  the designated skill above (`tau-tool-new` → `packages/tools/SKILL.md`).
- **AI providers** — every execution goes through `runPlan()`; the plan
  schema is zod-strict. Provider SDKs stay out of package.json except the
  sanctioned dynamic-import optionals; `MockProvider` is the offline
  fallback and the test double.
- **Plugins** — MCP servers are tool sources behind an optionalDependency
  seam: dynamically imported, never bundled, failures degrade to warnings.
- **TUI / WebUI** — front doors over the same reviewed pipeline; never add
  an execution path that bypasses `runPlan()`.

## Placement model (where a new SKILL.md goes)

| Position      | Location                                                       | Consumed by                                      | Versions with    |
| ------------- | -------------------------------------------------------------- | ------------------------------------------------ | ---------------- |
| Root router   | `/SKILL.md` (this file)                                        | AI coding agents via the AGENTS.md read chain    | the repo         |
| L1 workflow   | `.claude/skills/<name>/SKILL.md`                               | AI coding agents (root discovery + read chain)   | the repo         |
| L2 tool layer | `packages/<pkg>/SKILL.md` or `app/<app>/SKILL.md`              | AI coding agents (read chain; no auto-discovery) | the package/app  |
| L3 product    | `packages/skills/bundled/<name>/`, `templates/skill-template/` | the tau CLI at RUNTIME                           | the npm artifact |

Never mix layers: L3 files are data for the product; L1/L2 and this router
are instructions for coding agents. A file can only be one of them.

## Maintenance rule

- Adding an L1/L2 skill? Create it AND add its routing-table row in the
  same PR.
- Removing or renaming a skill? Update or delete its row in the same PR —
  a stale row is dead documentation.
- Changing a fast path? The row's command must stay copy-paste runnable.
