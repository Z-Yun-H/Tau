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

### Commit author identity (GitHub attribution)

Every commit's author AND committer email MUST resolve to the maintainer's
GitHub account — use the account's official noreply address
(`88868011+Z-Yun-H@users.noreply.github.com`; set it once via
`git config user.email`). **Never invent an address of the form
`<name>@users.noreply.github.com`**: GitHub links commits to accounts purely
by email, and that pattern matches the noreply address of whichever user is
named `<name>` — PR #127 briefly attributed an AI commit to the unrelated
GitHub user `ai` this way. AI participation is declared through the message
trailers below, never by rewriting the author identity. Check before every
push: `git log --format='%an <%ae> | %cn <%ce>' -1` must show the
maintainer identity on both sides.

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

1. `pnpm lint && pnpm typecheck && pnpm test:cov` green
2. Update CHANGELOG.md: move **Unreleased** → new version + date (today)
3. Bump versions in lockstep — the `@tau/*` packages ship as a version-locked
   family, and `pnpm publish` rewrites `workspace:*` to these very numbers,
   so all 11 workspace packages must carry the release version:

   ```bash
   pnpm -r exec pnpm version <major|minor|patch> --no-git-tag-version
   git add -A && git commit -m "chore(release): v<x.y.z>" && git tag v<x.y.z>
   ```

   (`-r` covers the publishable workspace packages; the private root is
   skipped. `@tau/cli` owns the `tau` bin, but it is no longer the only
   published package — its ten `@tau/*` siblings are published with it.)

4. `pnpm build` (unified tsdown workspace build) — confirm
   `app/cli/dist/index.js` starts with `#!/usr/bin/env node` and
   `node app/cli/dist/index.js --help` works
5. Smoke test the packed family — the tarballs depend on each other by the
   exact workspace version, so they are packed and installed together:

   ```bash
   pnpm -r pack   # → all tarballs land in the repo root, NOT next to each package.json
   ```

   Note: `-r pack` also emits a pack-only `tau-tool-<ver>.tgz` for the
   private root (empty, no deps) — `pnpm publish -r` ignores it.

   Then, in a scratch dir, install the whole family from the local
   tarballs and exercise the bin (npm dedupes the root tarball installs
   with the CLI's transitive `@tau/*@<ver>` requirements):

   ```bash
   mkdir -p /tmp/tau-smoke && cd /tmp/tau-smoke && npm init -y
   npm install $(ls <repo>/tau-*.tgz | grep -v '/tau-tool-')
   ./node_modules/.bin/tau --version
   ./node_modules/.bin/tau skill list
   ./node_modules/.bin/tau skill new demo test   # proves bundled/ + templates/ ship
   ./node_modules/.bin/tau ask "find ts files" --yes   # mock provider needs no network
   ```

   The tarball name follows each `@tau/*` package name (`@tau/cli` →
   `tau-cli-<ver>.tgz`), NOT the repo name. Structural gate: the packed
   manifests must contain no `workspace:` / `catalog:` specifiers —
   `pnpm pack` rewrites both (`for t in tau-*.tgz; do tar -xOzf "$t"
package/package.json | grep -E 'workspace:|catalog:' && echo "FAIL $t";
done` must find nothing). After the first real publish, a plain
   `npm install -g @tau/cli@<ver>` in a clean environment is the stronger
   regression check.

6. `pnpm publish -r --access public --no-git-checks` from the repo root
   (CI or maintainer): pnpm rewrites `workspace:*` and `catalog:` on the
   fly, publishes in dependency order, and skips the private root. Each
   package already declares `publishConfig: { access: "public" }` —
   scoped packages refuse to publish without it. Requires an npm account
   with access to the `@tau` scope.

## What ships in the packages (package.json "files")

- `app/cli` (`@tau/cli`): `dist/` built bundle — the published `tau` bin
- `packages/skills` (`@tau/skills`): `dist/`, `bundled/` bundled skills,
  `templates/` skill scaffold source (`tau skill new` reads it at runtime!)

Careful: `templates/` and `bundled/` are resolved relative to the `@tau/skills`
package root at runtime via `packages/skills/src/assets.ts packageRoot()`. If
you move them, update that function — the smoke test above breaks, that's your
signal. Note that today they ship inside the `@tau/skills` artifact, while the
`tau` bin ships as `@tau/cli` — both artifacts publish in the same lockstep
family release, which is what keeps the pair consistent.

## After release

- Push the tag
- Update README badge shields if versions appear in them
- Announce breaking changes in the GitHub release notes with migration steps
