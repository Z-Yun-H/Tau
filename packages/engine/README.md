# @tau/engine

The safety core — the only path through which anything executes in Tau. It
reviews every AI-proposed plan deterministically, executes steps with
timeouts and output caps, and runs the whole pipeline through `runPlan()`.

## Public API

Everything is exported from the package barrel (`src/index.ts`):

- **Safety reviewer** (`src/safety.ts`) — `reviewPlan()` assigns verdicts
  (`allow` / `confirm` / `blocked`) per step; `scanShellCommand()` deep-scans
  shell strings; the `DENY_PATTERNS` and `CAUTION_PATTERNS` tables are the
  single source of truth for risk classification
- **Executor** (`src/executor.ts`) — `executeStep()` runs one approved step
  with timeout / output-cap enforcement (`ExecutorOptions`); `runShell()` is
  the guarded process primitive
- **Session** (`src/session.ts`) — `runPlan()` is THE only execution channel
  (review → confirm → execute → history); `renderReview()` and
  `renderPlan()` produce the human-facing review output

Invariants: `blocked` steps are never executed — no flag can override that;
plugin tools always enter review as medium risk; mutating tools default to
dry-run.

## Dependencies

- Runtime: none
- Workspace: `@tau/core`, `@tau/tools`

## Development

```bash
pnpm --filter @tau/engine build
pnpm test
```

Never weaken the safety reviewer to make a feature easier — see
[docs/safety.md](../../docs/safety.md) and the
[architecture rulebook](../../AGENTS/architecture.md).
