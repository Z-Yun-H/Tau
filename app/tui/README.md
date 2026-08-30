# @tau/tui

`tau-tui` — the interactive terminal session. A readline REPL that keeps a
running session with slash commands while every intent still goes through the
same plan → review → confirm → `runPlan()` pipeline as `tau ask`. Refuses to
start when stdin is not a TTY (use `tau ask` in scripts instead).

## Slash commands

| Command     | Effect                                      |
| ----------- | ------------------------------------------- |
| `/help`     | command overview                            |
| `/provider` | show/switch the active AI provider          |
| `/skills`   | list available skills                       |
| `/history`  | recent executed plans                       |
| `/status`   | session summary (provider, model, counters) |
| `/clear`    | reset the conversation view                 |

Anything that is not a slash command is treated as an intent: it is planned
by the resolved provider, reviewed by the safety gate, and executed only
after confirmation (or `autoApproveAll` when the session was started in
auto-approve mode — same semantics as `tau ask --yes`).

## Public API

- `startTui()` — the REPL entry (bin `tau-tui`, also exposed as `tau tui`)
- `registerTuiCommand()` — wires `tau tui` into the CLI program

## Dependencies

- Runtime: none
- Workspace: `@tau/agent`, `@tau/engine`, `@tau/ui`, `@tau/core`

## Development

```bash
pnpm dev:tui                        # run from source
pnpm --filter @tau/tui build
```

No new execution channels: the TUI is a front door, the engine is the door.
