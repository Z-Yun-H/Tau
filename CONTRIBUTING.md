# Contributing to Tau

Thanks for helping build Tau. This repo is engineered to be worked on by
humans **and** AI agents — start with whichever fits you:

- Humans: this file, then [docs/architecture.md](docs/architecture.md)
- AI agents: [AGENTS.md](AGENTS.md) (entry) → the relevant
  [AGENTS/](AGENTS/) rulebook for the subsystem you touch

## The pre-PR gate (mandatory)

```bash
pnpm lint && pnpm typecheck && pnpm test:cov
```

All green, coverage ≥ thresholds (see `vitest.config.ts`), no skipped tests.
CI runs the same gate.

## PR workflow (mandatory)

**Never push directly to `main`.** All changes — features, fixes, docs,
refactors — land through pull requests:

1. Cut a branch from `main`: `feat/<topic>`, `fix/<topic>`, `refactor/<topic>`,
   `docs/<topic>`
2. Commit there using Conventional Commits (one logical change per PR)
3. Run the pre-PR gate on your branch
4. Push the branch and open a PR against `main` (the repo has a PR template —
   fill in the checklist)
5. Merge after the gate is green

Direct pushes to `main` are reserved for maintainers' exceptional housekeeping
(e.g. reverting a broken merge) and should be avoided all the same.

## AI-assisted commits

Commits authored by an AI agent are welcome but must never be silent: the
agent presents an **AI commit declaration** before committing and the commit
message ends with the `AI-declaration:` trailer block (format in
[AGENTS/release.md](AGENTS/release.md), template in `.gitmessage`). Human
authors never add the block.

## Ground rules

1. **Never weaken the safety reviewer** (`packages/engine/src/safety.ts`)
   to make a feature easier. Fix the feature.
2. **New behavior needs tests.** Safety-adjacent changes need positive AND
   benign-lookalike test pairs.
3. **User-facing changes update both READMEs** (`README.md` + `README.zh-CN.md`)
   and, when applicable, `docs/safety.md` / `docs/skills-authoring.md`.
4. **Runtime dependencies are frozen** and live in the package that imports
   them (commander in apps, chalk in `@tau/ui`, yaml+zod in `@tau/skills`,
   zod in `@tau/ai`). Adding one requires justification + AGENTS.md update.
5. **Dry-run by default** for anything that mutates.
6. Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
7. **Workspace hygiene**: cross-package imports go through declared `@tau/*`
   `workspace:*` deps and the target package's barrel — never relative paths
   across packages, never `@tau/x/src/...` deep imports.

## Dev workflow

```bash
pnpm install
pnpm build                          # build every workspace package (topological)
pnpm dev -- file find "*.ts"        # run the CLI from source
pnpm --filter @tau/tui dev          # interactive TUI from source
pnpm --filter @tau/webui dev        # web UI from source
pnpm test:watch                     # focused loop
```

Environment: pnpm ≥ 10 (`corepack enable pnpm`) and Node **>= 22.18** to
develop (the oxc toolchain enforces it via `devEngines`; the published CLI
itself runs on Node >= 20.19). VS Code / Codex users: open the repo in a Dev
Container (`.devcontainer/`) for a pre-configured environment.

## Reporting bugs

Include: `tau --version`, OS, the command you ran, what you expected, and
(history file willing) the relevant `history.jsonl` entry. Security-relevant
findings — especially safety-gate bypasses — open a private security advisory
instead of a public issue.
