# AGENTS/release.md — versioning & publishing

## Commit & PR workflow (mandatory)

**Never push directly to `main`.** Every change lands through a pull request:

1. Cut a feature branch from `main`: `refactor/<topic>`, `feat/<topic>`,
   `fix/<topic>`, `docs/<topic>`
2. Commit there (Conventional Commits — see AGENTS.md checklist)
3. Run the full gate (`pnpm lint && pnpm typecheck && pnpm test`) on the branch
4. Push the branch and open a PR against `main` with the PR template filled in
5. Merge only after the gate is green; rebase (or squash) — no merge commits
   with conflicts left unresolved

Hotfixes follow the same path — a fast-track PR is still a PR.

## Versioning

Semantic versioning. Tau is pre-1.0: breaking CLI behavior may land in MINOR
versions, but must be called out in CHANGELOG under a **Breaking** header.

- MAJOR: safety contract changes (schema of plans, risk semantics), CLI
  removals
- MINOR: new tools, providers, commands, flags
- PATCH: fixes, docs, deps

## Release checklist

1. `npm run lint && npm run typecheck && npm run test:cov` green
2. Update CHANGELOG.md: move **Unreleased** → new version + date (today)
3. Bump `version` in package.json (`npm version <major|minor|patch>` makes
   the commit + tag)
4. `npm run build` — confirm dist/index.js starts with
   `#!/usr/bin/env node` and `node dist/index.js --help` works
5. Smoke test the packed artifact:
   `npm pack` then in a scratch dir `npm install -g tau-tool-<ver>.tgz`,
   run `tau --version`, `tau skill list`, `tau ask "find ts files" --yes`
   (mock provider needs no network)
6. `npm publish` (CI or maintainer)

## What ships in the packages (package.json "files")

- `app/cli` (`@tau/cli`): `dist/` built bundle — the published `tau` bin
- `packages/skills` (`@tau/skills`): `dist/`, `bundled/` bundled skills,
  `templates/` skill scaffold source (`tau skill new` reads it at runtime!)

Careful: `templates/` and `bundled/` are resolved relative to the `@tau/skills`
package root at runtime via `packages/skills/src/assets.ts packageRoot()`. If
you move them, update that function — the smoke test below breaks, that's your
signal.

## After release

- Push the tag
- Update README badge shields if versions appear in them
- Announce breaking changes in the GitHub release notes with migration steps
