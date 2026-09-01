# TUI run screenshots

Real interactive sessions of the **built TUI** (`app/tui/dist/index.js`),
driven through a pty with staggered scripted keystrokes (exactly what a user
types), captured with `script(1)` and rendered to SVG by
`scripts/screenshot/term-svg.mjs`. Offline throughout — the mock provider
plans and the deterministic safety gate rules.

| file             | what it shows                                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `overview.svg`   | session banner + `/help` + `/status` + `/provider` — the command surface                                               |
| `markdown.svg`   | `/md demo.md` — headings, fenced code, a aligned table, blockquote, CJK text through the `@tau/markdown` ANSI renderer |
| `image-view.svg` | `/view logo.png` — the metadata card fallback when the terminal advertises no inline-image protocol                    |
| `plan-flow.svg`  | an intent → mock plan → review → `y` confirm → execution — the full safety loop inside the session                     |

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
