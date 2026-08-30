# Contributing to Tau

Thanks for helping build Tau. This repo is engineered to be worked on by
humans **and** AI agents — start with whichever fits you:

- Humans: this file, then [docs/architecture.md](docs/architecture.md)
- AI agents: [AGENTS.md](AGENTS.md) (entry) → the relevant
  [AGENTS.d/](AGENTS.d/) rulebook for the subsystem you touch

## The pre-PR gate (mandatory)

```bash
npm run lint && npm run typecheck && npm run test:cov
```

All green, coverage ≥ thresholds (see `vitest.config.ts`), no skipped tests.
CI runs the same gate.

## Ground rules

1. **Never weaken the safety reviewer** (`src/core/safety.ts`) to make a
   feature easier. Fix the feature.
2. **New behavior needs tests.** Safety-adjacent changes need positive AND
   benign-lookalike test pairs.
3. **User-facing changes update both READMEs** (`README.md` + `README.zh-CN.md`)
   and, when applicable, `docs/safety.md` / `docs/skills-authoring.md`.
4. **Runtime dependencies are frozen** (commander, chalk, yaml, zod). Adding
   one requires justification + AGENTS.md update.
5. **Dry-run by default** for anything that mutates.
6. Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.

## Dev workflow

```bash
npm install
npm run dev -- file find "*.ts"     # run from source
npm run test:watch                  # focused loop
```

Environment: Node ≥ 20. VS Code / Codex users: open the repo in a Dev
Container (`.devcontainer/`) for a pre-configured environment.

## Reporting bugs

Include: `tau --version`, OS, the command you ran, what you expected, and
(history file willing) the relevant `history.jsonl` entry. Security-relevant
findings — especially safety-gate bypasses — open a private security advisory
instead of a public issue.
