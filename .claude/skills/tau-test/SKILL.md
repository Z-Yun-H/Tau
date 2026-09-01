---
name: tau-test
description: Run the Tau test suite with proper isolation (TAU_HOME sandboxing) and interpret failures. Use after any code change, before every commit/PR.
---

# Test Tau

## Commands

```bash
pnpm test           # full suite once
pnpm test:watch     # filtered dev loop: pnpm test:watch -- safety
pnpm test:cov       # with coverage thresholds (pre-PR gate)
```

## Rules the suite depends on

- Tests set `TAU_HOME` to tmp dirs; NEVER run tests with your real `~/.tau`
  in the environment — history/config tests would write to it.
- Coverage thresholds are 55/55/55/55. Failing threshold = failing build.
  Add tests; do not lower thresholds.
- No test may open network sockets. Providers are tested through MockProvider
  or mocked fetch.

## Reading failures

1. **safety.test.ts failures** — you (or someone) changed DENY_PATTERNS or
   the reviewer. This is the most important file in the repo; restore
   behavior or add the missing benign-lookalike test.
2. **app/cli/tests/cli.test.ts timeouts** — likely a confirm() prompt waiting
   on stdin; the test env is non-TTY so runPlan must be called with
   `assumeYes` or `autoApproveAll`.
3. **skills tests failing after schema edits** — update the fixture
   SKILL.md files AND the spec in AGENTS/skills.md together; the authoring
   workflow itself lives in the tool-layer skill `packages/skills/SKILL.md`.

## Before you say "done"

```bash
pnpm lint && pnpm typecheck && pnpm test:cov
```

All green, coverage at or above thresholds, no skipped tests added.

Report the results in the PR body ("How it was tested" section + the
commit's `AI-gate:` trailer) — tests never run is as bad as failing tests
(AGENTS/collaboration.md §11). If CI fails: root-cause it, fix it, add or
repair the missing test; never bypass a check.
