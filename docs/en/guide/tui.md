# Terminal UI

`tau tui` is the full-keyboard terminal interface: the same engine, the same review gate, just rendered fullscreen.

```bash
tau tui
```

## Design notes

- **Keyboard first**: everything is reachable without a mouse; arrows/enter navigate, in-app help lists shortcuts.
- **Slash command palette (v0.6.0)**: typing `/` on an empty line opens a filterable command palette — keep typing to narrow, `↑`/`↓` to move, `Tab`/`Enter` to insert, `Esc` to dismiss; the palette, dispatch and `/help` share one command catalog, so what is shown can never drift from what runs.
- **ANSI rendering**: plan explanations and results render as ANSI text through the shared markdown layer (`@tau/markdown` emits both HTML and ANSI from one abstraction).
- **The same gate**: the verdicts and confirmations you see in the TUI are identical to CLI and WebUI — it is not "a looser mode".

## When the TUI fits

- Multi-turn conversations in the terminal without retyping `tau ask`;
- Working over SSH with no browser;
- Fullscreen focus without leaving the terminal.

The three front doors divide by context: **CLI** for one-shots and pipes, **TUI** for immersive terminal work, **WebUI** for the richest visuals (thinking panels, tool cards, file viewer). The engine is one.
