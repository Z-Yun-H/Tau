<!--
  Every change lands on main through a PR (see CONTRIBUTING.md / AGENTS/release.md).
  Keep PRs to one logical change. Run the pre-PR gate before opening:
  pnpm lint && pnpm typecheck && pnpm test
-->

## What & why

<!-- One paragraph: what changed and why it is needed. Link the issue if any. -->

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
- [ ] Affected `AGENTS/*.md` / `docs/*.md` rulebooks updated
