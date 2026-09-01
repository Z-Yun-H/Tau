# @tau/tui

`tau-tui` — the interactive terminal session. A readline REPL that keeps a
running session with slash commands while every intent still goes through the
same plan → review → confirm → `runPlan()` pipeline as `tau ask`. Refuses to
start when stdin is not a TTY (use `tau ask` in scripts instead).

## Screenshots

Real pty sessions driven with scripted keystrokes, rendered to SVG
(regeneration: [docs/screenshots/README.md](./docs/screenshots/README.md)):

**plan → confirm → run — the safety loop inside the session**

![tui plan flow](./docs/screenshots/plan-flow.svg)

**`/md` — markdown through the `@tau/markdown` ANSI renderer (tables, code, CJK)**

![tui markdown](./docs/screenshots/markdown.svg)

More: `overview.svg` (command surface), `image-view.svg` (inline image /
metadata-card fallback).

## Slash commands

| Command     | Effect                                      |
| ----------- | ------------------------------------------- |
| `/help`     | command overview                            |
| `/provider` | show/switch the active AI provider          |
| `/skills`   | list available skills                       |
| `/history`  | recent executed plans                       |
| `/status`   | session summary (provider, model, counters) |
| `/clear`    | reset the conversation view                 |

Intents show a live planning spinner, and the plan explanation renders as
markdown through the same `@tau/markdown` ANSI renderer.

Anything that is not a slash command is treated as an intent: it is planned
by the resolved provider, reviewed by the safety gate, and executed only
after confirmation (or `autoApproveAll` when the session was started in
auto-approve mode — same semantics as `tau ask --yes`).

## Public API

- `startTui()` — the REPL entry (bin `tau-tui`; wired into the CLI lazily via dynamic import)

## Dependencies

- Runtime: none
- Workspace: `@tau/agent`, `@tau/engine`, `@tau/markdown`, `@tau/ui`, `@tau/core`

## Development

```bash
pnpm dev:tui                        # run from source (tsx, dev condition)
pnpm --filter @tau/tui dev          # vite build --watch (dev loop)
pnpm --filter @tau/tui build        # vite build (node/SSR mode, dist/index.js)
```

Build: vite in node/SSR mode (see `vite.config.ts`) — workspace `@tau/*`
siblings stay external and the `#!/usr/bin/env node` shebang is re-added to
`dist/index.js` so the `bin` stays executable.

No new execution channels: the TUI is a front door, the engine is the door.
