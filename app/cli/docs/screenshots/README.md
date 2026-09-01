# CLI run screenshots

Real runs of the **built binary** (`app/cli/dist/index.js`) inside a
throwaway demo workspace, captured through a pty and rendered to SVG by the
zero-dependency `scripts/screenshot/term-svg.mjs`.

| file            | what it shows                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `help.svg`      | `tau --help` — the full command map                                                                                                                |
| `file-find.svg` | `tau file find "*.md"` — a read-only tool run and its output                                                                                       |
| `ask.svg`       | `tau ask "find all *.md files" --yes` — natural language in, the mock provider plans, the deterministic gate approves, the tool runs — all offline |

## Regenerate

```bash
pnpm build    # the screenshots come from the built binary
export TAU_HOME=$(mktemp -d) TERM=xterm-256color COLORTERM=truecolor
demo=$(mktemp -d); mkdir -p "$demo/docs"; cd "$demo"
echo "# demo workspace" > readme.md; echo "- note" > docs/notes.md

repo=$PWD/..  # adjust to the repo root
script -qec "node $repo/app/cli/dist/index.js --help" /tmp/cap.raw </dev/null >/dev/null
node $repo/scripts/screenshot/term-svg.mjs /tmp/cap.raw --title "\$ tau --help" \
  > $repo/app/cli/docs/screenshots/help.svg
# repeat for: file find '*.md'  → file-find.svg
#              ask 'find all *.md files' --yes → ask.svg
```

`script(1)` forwards the pty; `term-svg.mjs` strips its banners and renders
the final screen. Full tool docs: [`scripts/screenshot/README.md`](../../../scripts/screenshot/README.md).
