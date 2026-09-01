# term-svg.mjs — terminal capture → SVG screenshot

Zero-dependency renderer that turns a **raw pty capture** (real bytes a real
terminal received) into an SVG screenshot: it feeds the capture through a
minimal VT/xterm emulator — SGR colors (basic/256/truecolor), bold, dim,
italic, underline, cursor movement, line/display erase, carriage returns —
and renders the **final screen state** as text-based SVG (diff-friendly,
viewable on GitHub; every run carries `textLength` so glyph columns stay
aligned under any monospace font).

```bash
node scripts/screenshot/term-svg.mjs < capture.raw > shot.svg
node scripts/screenshot/term-svg.mjs capture.raw --title "$ tau --help" --min-cols 90
```

Options: `--title` (labeled header bar), `--min-cols` (minimum width),
`--char-width` (grid advance, default 7.85).

## How the committed screenshots are produced

1. Run the real app inside a pty with `script(1)` and a color-forcing
   environment (`TERM=xterm-256color COLORTERM=truecolor`, fresh `TAU_HOME`
   sandbox, a throwaway demo directory with fixture files).
2. Render the capture: `term-svg.mjs <capture.raw> --title "$ <command>"`.
3. The tool strips `script`'s own `Script started/done` banners (capture-tool
   artifacts, not app output) and crops leading/trailing blank rows.

Full capture matrices per app: `app/cli/docs/screenshots/README.md`,
`app/tui/docs/screenshots/README.md`, `app/webui/docs/screenshots/README.md`
(the WebUI screenshots are PNGs from a real headless-Chromium session —
`app/webui/scripts/screenshot.mjs`).
