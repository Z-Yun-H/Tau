# @tau/ui

Terminal UI primitives shared by the CLI and TUI apps: the chalk theme, the
confirm prompt, and the zero-dependency interactive list picker. All
user-facing color goes through the theme — never raw chalk elsewhere.

## Public API

Everything is exported from the package barrel (`src/index.ts`):

- **Theme** (`src/theme.ts`) — the `theme` object (semantic colors for
  success/warn/danger/muted/...) used by every rendering surface
- **Confirm** (`src/confirm.ts`) — `confirm()` yes/no prompt returning a
  typed `ConfirmAnswer`
- **Picker** (`src/picker.ts`) — `selectFromList()` (raw-mode arrow-key /
  j-k / enter / esc selection with a scrolling viewport; numbered fallback
  when stdin is not a TTY) and `promptHidden()` (masked input for API keys,
  `*` echo, backspace editing); streams are injectable, which is what makes
  the picker testable (`PickerOptions`)

The picker never hangs in non-interactive environments: callers pass explicit
choices or fall back to numbered selection — the same contract the
`tau provider use` flow relies on in CI.

## Dependencies

- Runtime: `chalk`
- Workspace: none (leaf package)

## Development

```bash
pnpm --filter @tau/ui build
pnpm test   # ui-picker tests use injected fake TTY streams
```

See [AGENTS/conventions.md](../../AGENTS/conventions.md) for the
"theme-only color" rule.
