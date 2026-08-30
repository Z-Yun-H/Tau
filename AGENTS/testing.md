# AGENTS/testing.md — how we test Tau

Runner: **vitest** (`vitest.config.ts`). Coverage v8 with thresholds at 55%
statements/branches/functions/lines — raise them when convenient, never lower
them to make a PR pass.

## Commands

```bash
npm test            # run once
npm run test:watch  # dev loop
npm run test:cov    # with coverage (pre-PR gate)
```

## Isolation rules

1. **TAU_HOME**: every test that touches config/history/skills must set
   `process.env.TAU_HOME` to a fresh tmp dir (see
   `tests/unit/config-store.test.ts` for the pattern) and clean up in
   `afterEach`. NEVER let tests write to a real `~/.tau`.
2. **cwd-sensitive tools** (`file.*`, `text.*`): `process.chdir(tmpDir)` +
   fixture files, restore after. Keep fixture trees tiny (3-5 files).
3. **No network in tests.** Provider tests use MockProvider or `vi.mock` /
   injected fakes. Ollama/OpenAI providers are tested at the request-shaping
   level only (or skipped).
4. **Non-interactive default**: `runPlan` refuses to execute without a TTY
   unless `--yes`/`autoApproveAll`. In tests, pass
   `autoApproveAll: true, skipHistory: true` (or a TAU_HOME you own).

## What must always have tests

| Area                 | Required cases                                                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| safety.ts            | every DENY_PATTERNS entry matches; benign lookalikes do NOT over-match (e.g. `rm old.txt` → high not blocked; `rm -rf /` → blocked); plan step cap; unknown tool step |
| validatePlanResponse | strict JSON pass; fenced JSON pass; prose-wrapped pass; invalid JSON throws; schema violation throws; >10 steps rejected                                              |
| tools                | happy path + error path per tool op; dry-run default for rename/replace; execute:true applies; SKIP_DIRS respected in text.search                                     |
| skills               | valid SKILL.md parses; each frontmatter rule violation yields an issue; deny-listed skill command flagged; origin precedence user > bundled                           |
| session/runPlan      | deny → no execution + history "denied"; confirm "no" → cancelled; mock provider end-to-end                                                                            |
| CLI integration      | spawn-like runs through `main()` with argv; see tests/integration/cli.test.ts                                                                                         |

## Test style

- Plain vitest, no global API (`globals: false`): import
  `{ describe, it, expect }` explicitly.
- One `describe` per module; `it` names read like sentences:
  `it("denies a plan whose shell step pipes curl into sh")`.
- Prefer testing through public functions (`runPlan`, `validatePlanResponse`,
  `scanSkills`) over internals. Reach into internals only when a behavior
  (like a regex) is hard to trigger end-to-end.
- Snapshot tests: avoid, except CLI help output if ever needed.
- Fixtures live in `tests/fixtures/`; generate tmp files at runtime when the
  test mutates them.

## Adding a tool? Copy this test skeleton

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
// registerCoreTools() once (registry import order matters); getTool("<name>")

describe("tool <family>.<verb>", () => {
  it("does the happy path", async () => {
    const tool = getTool("<family>.<verb>")!;
    const result = await tool.run({/* minimal args */});
    expect(result.text).toContain("expected");
  });

  it("throws a readable error on bad input", async () => {
    await expect(getTool("<family>.<verb>")!.run({})).rejects.toThrow(/readable message/i);
  });
});
```
