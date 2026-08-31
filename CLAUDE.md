# CLAUDE.md

All agent instructions for working in this repository live in
[AGENTS.md](./AGENTS.md) (entry point) and [AGENTS/](./AGENTS/) (per-subsystem
rulebooks: collaboration, architecture, conventions, testing, skills,
ai-integration, release).

Read AGENTS.md — and the mandatory
[AGENTS/collaboration.md](./AGENTS/collaboration.md) operating norms
(issue→PR flow, AI labeling, changelog fragments, merge policy) — before
making any change. The golden rules and the pre-PR gate
(`pnpm lint && pnpm typecheck && pnpm test`) are mandatory.
