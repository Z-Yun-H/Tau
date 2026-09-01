---
name: tau-dev
description: Run and debug Tau from source during development — the pnpm dev bridge, per-app dev entries (TUI/WebUI), offline mock provider, TAU_HOME sandboxing for manual runs, and watch loops. Use when developing, manually exercising commands, or debugging without building.
---

# Develop Tau (dev inner loop)

The stage between editing code and running the gates. Build/test/release
have their own skills (`tau-build`, `tau-test`, `tau-release`); this is the
run-and-debug loop.

## Commands (all verified, from the repo root)

```bash
pnpm dev -- file find "*.ts"          # CLI from TypeScript source — no build needed
pnpm dev -- ask "find ts files"       # offline by default (mock provider, no API key)
pnpm dev -- skill list                # any command family works through the bridge
pnpm dev:tui                          # TUI REPL from source (tsx --conditions=development)
pnpm dev:web                          # WebUI API server from source (same mechanism)
pnpm --filter @tau/webui dev          # WebUI client dev server (vite dev) — run alongside dev:web
pnpm --filter @tau/tui dev            # TUI: vite build --watch (rebundles dist on change)
pnpm test:watch -- safety             # filtered vitest watch loop
```

`pnpm dev` is `tsx --conditions=development app/cli/src/index.ts`: the
`development` export condition resolves every `@tau/*` import to TypeScript
source, so edits apply on the next run with zero build. The WebUI in dev is
TWO processes (API server via `dev:web` + client dev server via
`pnpm --filter @tau/webui dev`); start both.

## Rules the loop depends on

- **Sandbox manual runs**: `export TAU_HOME=$(mktemp -d)` before
  hand-testing anything that writes config or history — vitest does this
  automatically, your shell does not. Never develop against your real
  `~/.tau`.
- **Offline-first**: the bundled mock provider plans without any key or
  network. Real providers are for explicit, intentional testing only —
  never inside tests (no test opens a socket).
- **Plain text out**: tool/provider code returns plain text; color lives
  only in `@tau/cli`/`@tau/ui`. If you see ANSI in a tool's output while
  developing, fix the tool, not the terminal.
- **From-source ≠ built**: `development` runs skip `dist/` entirely; before
  committing anything the built apps must still work (`pnpm build` +
  `tau-build` checks).

## When to switch skills

- Before you claim done → `tau-test` (full gates + coverage + reporting).
- Bundle/external/shebang issues → `tau-build`.
- Cutting a release → `tau-release`.
