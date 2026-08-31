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

## AI commit declaration (mandatory)

**No silent AI commits.** When a commit is authored by an AI agent:

1. **Before committing**, the agent must PRESENT the declaration to the human
   in the session — the human sees exactly what will be recorded before it
   lands.
2. The commit message MUST carry the `AI-Generated: <one-line summary>` line
   right after the subject/body, and MUST end with the declaration block (the
   template lives in `.gitmessage`, wired via `git config commit.template`):

   ```
   AI-Generated: <one line — what the AI did, e.g. "safety fix for stepRiskOf">
   AI-declaration: this commit was authored by an AI agent under human direction.
   AI-agent: <agent name and model, e.g. Super Z (GLM)>
   AI-scope: <one line — exactly what the AI did in this commit>
   AI-gate: lint=pass typecheck=pass test=pass (<N> tests)
   ```

3. `AI-gate` must reflect the real, just-run gate result — never copy a stale
   status into it.
4. The PR body must note "此 PR 由 AI 生成" and follow
   [AGENTS/collaboration.md](./collaboration.md) (issue→PR, tags, changelog
   fragment, no self-merge).
5. Human authors never include the block or the prefix line.

The trailers are grep-able history: `git log --grep '^AI-declaration:' -E`
(or `--grep '^AI-Generated:' -E`) lists every AI-touched commit.

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
3. Bump `version` in `app/cli/package.json` (the published `@tau/cli` —
   it owns the `tau` bin and the release version): run
   `npm version <major|minor|patch>` inside `app/cli/` — makes the commit
   - tag
4. `pnpm build` (unified tsdown workspace build) — confirm
   `app/cli/dist/index.js` starts with `#!/usr/bin/env node` and
   `node app/cli/dist/index.js --help` works
5. Smoke test the packed artifact: `pnpm pack` inside `app/cli/` produces
   `tau-cli-<ver>.tgz` (the tarball name follows the `@tau/cli` package
   name, NOT the repo name), then in a scratch dir
   `npm install -g <path>/tau-cli-<ver>.tgz`, run `tau --version`,
   `tau skill list`, `tau ask "find ts files" --yes` (mock provider needs
   no network)

   > **Known gap (blocked — track it in the packaging issue #23):** the
   > smoke test above currently CANNOT pass. `pnpm pack` rewrites the
   > `@tau/*` `workspace:*` dependencies to workspace versions, and
   > `npm install` then 404s resolving the unpublished scoped packages from
   > the public registry (`@tau/agent@0.1.0` → 404, verified 2026-08).
   > Pick a publish strategy first — self-contained CLI bundle with
   > `publishConfig`, family publishing via `pnpm publish`, or GitHub
   > Releases artifacts — then unblock steps 5-6.

6. `npm publish` (CI or maintainer) — blocked by the same gap

## What ships in the packages (package.json "files")

- `app/cli` (`@tau/cli`): `dist/` built bundle — the published `tau` bin
- `packages/skills` (`@tau/skills`): `dist/`, `bundled/` bundled skills,
  `templates/` skill scaffold source (`tau skill new` reads it at runtime!)

Careful: `templates/` and `bundled/` are resolved relative to the `@tau/skills`
package root at runtime via `packages/skills/src/assets.ts packageRoot()`. If
you move them, update that function — the smoke test below breaks, that's your
signal. Note that today they ship inside the `@tau/skills` artifact, while the
`tau` bin ships as `@tau/cli` — the pack/publish flow must keep the two
consistent (see the packaging gap note above).

## After release

- Push the tag
- Update README badge shields if versions appear in them
- Announce breaking changes in the GitHub release notes with migration steps
