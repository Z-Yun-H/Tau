# TUI run screenshots

Real interactive sessions of the **built TUI** (`app/tui/dist/index.js`),
driven through a pty with staggered scripted keystrokes (exactly what a user
types), captured with `script(1)` and rendered to SVG by
`scripts/screenshot/term-svg.mjs`. Offline throughout — the mock provider
plans and the deterministic safety gate rules.

| file                       | what it shows                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `overview.svg`             | session banner + `/help` + `/status` + `/provider` — the command surface                                                  |
| `markdown.svg`             | `/md demo.md` — headings, fenced code, a aligned table, blockquote, CJK text through the `@tau/markdown` ANSI renderer    |
| `image-view.svg`           | `/view logo.png` — the metadata card fallback when the terminal advertises no inline-image protocol                       |
| `plan-flow.svg`            | an intent → mock plan → review → `y` confirm → execution — the full safety loop inside the session                        |
| `slash-palette.svg`        | `/` as the whole buffer — the live command palette over the 9-command TUI catalog, with the 1/9 counter (v0.6.0)          |
| `slash-palette-filter.svg` | typing narrows the palette live (`s` → /skills + /status, 1/2) (v0.6.0)                                                   |
| `slash-palette-select.svg` | ↓ moves the selection — the counter and highlight track the keyboard (2/9) (v0.6.0)                                       |
| `model-picker.svg`         | `/model` — the catalog picker over the mock provider's deterministic offline catalog, frozen mid-overlay (v0.6.2)         |
| `model-picked.svg`         | Enter resolves the picker — “Model set to “mock-chat”.” persisted to the sandbox config (v0.6.2)                          |
| `thinking.svg`             | `/thinking` honest capability answer on the knob-less mock + `/provider` with the model and thinking state lines (v0.6.2) |

The plan-flow capture double-runs as an e2e regression check for the
single-reader confirm (#69): the confirm prompt echoes each key once and the
answer never leaks back as a phantom intent.

## Regenerate

```bash
pnpm build
export TAU_HOME=$(mktemp -d) TERM=xterm-256color COLORTERM=truecolor
demo=$(mktemp -d); cd "$demo"
printf '# Tau UX Demo\n\n**bold**, `code`, table + CJK …\n' > demo.md
repo=<repo-root>

( sleep 1.2; printf '/help\n'; sleep 0.5; printf '/status\n'; sleep 0.5; \
  printf '/provider\n'; sleep 0.5; printf '/exit\n' ) | \
  script -qec "node $repo/app/tui/dist/index.js" /tmp/cap.raw >/dev/null
node $repo/scripts/screenshot/term-svg.mjs /tmp/cap.raw \
  --title "tau tui — /help, /status, /provider" > $repo/app/tui/docs/screenshots/overview.svg
# repeat for: /md demo.md → markdown.svg · /view logo.png → image-view.svg
#             intent 'find all *.md files' + y + /exit → plan-flow.svg
```

Input is fed with sleeps so the REPL is already prompting when each line
arrives (pre-start echo would land above the banner). Full tool docs:
[`scripts/screenshot/README.md`](../../../scripts/screenshot/README.md).

The v0.6.0 palette shots freeze mid-overlay instead of exiting: typing
`/` as the whole empty buffer opens the palette, and it hangs (without
erasing) while stdin stays open — so hold the pipe, then TERM **node
only**; script notices its child exited and flushes the capture cleanly
(SIGKILL loses the buffered capture, EOF dismisses the overlay).

```bash
( sleep 1.2; printf '/'; sleep 30 ) | \
  script -qec "node $repo/app/tui/dist/index.js" /tmp/cap.raw >/dev/null 2>&1 &
bg=$!; sleep 3.4
pkill -TERM -f "^node $repo/app/tui/dist/index.js"; wait "$bg" || true
node $repo/scripts/screenshot/term-svg.mjs /tmp/cap.raw \
  --title "tau tui — '/' live command palette (shared catalog)" --min-cols 96 \
  > $repo/app/tui/docs/screenshots/slash-palette.svg
# repeat: '/' + 's' → slash-palette-filter.svg · '/' + ↓ (\x1b[B) → slash-palette-select.svg
```

The v0.6.2 model/thinking shots are scripted by
`scripts/tui-shots-v062.mjs` (repo root) — it encodes the palette dance:
typing "/" alone opens the palette, the rest of the command is typed
char-by-char (a burst races the takeover), Enter inserts an exact
command (arg placeholders are stripped with backspaces), a non-prefix
line dismisses the palette back into the buffer, and a bare LF never
submits a readline line — CR does.

```bash
node scripts/tui-shots-v062.mjs   # → model-picker.svg, model-picked.svg, thinking.svg
```
