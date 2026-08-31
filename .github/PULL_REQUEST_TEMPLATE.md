<!--
  Every change lands on main through a PR (see CONTRIBUTING.md / AGENTS/collaboration.md).
  Keep PRs to one logical change, linked to its Issue. Run the pre-PR gate before opening:
  pnpm lint && pnpm typecheck && pnpm test
-->

## What & why

<!-- One paragraph: what changed and why it is needed. Link the issue if any. -->
<!-- Refactor or architecture change? Tag the PR title [REFACTOR] / [ARCHITECTURE]
     and include motivation, impact scope, risks and a structure-impact statement. -->

## 结构影响说明 (structure impact)

<!-- New/changed modules & responsibilities; dependency changes (catalog?);
     coupling points or risks. Required for every PR. -->

> 此 PR 由 AI 生成（AI-authored PRs must state this; human PRs remove the line）

## How it was tested

<!-- Which gate commands ran; new/updated tests; manual smoke steps. -->

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test` (no skipped tests)
- [ ] New behavior has tests (safety-adjacent: positive + benign-lookalike pairs)

## Safety & invariants checklist

<!-- Tau invariants: runPlan is the only execution channel; blocked steps never
     run; plugin tools are always medium risk; mutating tools default to dry-run. -->

- [ ] The safety reviewer (`packages/engine/src/safety.ts`) was NOT weakened
- [ ] No new execution channel besides `runPlan()`
- [ ] No new runtime dependency (or justified in AGENTS.md if there is one)

## Docs

- [ ] User-facing changes documented in BOTH `README.md` and `README.zh-CN.md`
- [ ] `CHANGELOG.md` entry under **Unreleased**
- [ ] Affected `AGENTS/*.md` / `.claude/skills/` / `docs/*.md` updated
- [ ] AI-authored? → PR body notes "此 PR 由 AI 生成"; commits carry the
      `AI-Generated:` line + `AI-declaration:` block
      (see [AGENTS/collaboration.md](../AGENTS/collaboration.md))
