---
name: tau-release
description: Cut a Tau release: changelog, version bump, build verification, pack smoke test. Use when the maintainer asks to release or bump the version.
---

# Release Tau

Follow the full checklist in AGENTS/release.md. Short form:

1. **Gate**: `pnpm lint && pnpm typecheck && pnpm test:cov` — all green.
2. **Changelog**: move `## Unreleased` entries to `## vX.Y.Z - YYYY-MM-DD`
   (Conventional Commits since last tag decide minor vs patch; breaking →
   minor until 1.0, with a **Breaking** header). Distill from the daily
   `changelog/YYYY-MM-DD.md` files (AGENTS/collaboration.md §8): make sure
   every change recorded there since the last tag is represented, then the
   daily files remain as the historical audit trail.
3. **Version**: bump all workspace packages in lockstep (the `@tau/*`
   family publishes together, and `pnpm publish` rewrites `workspace:*`
   to these very numbers):
   `pnpm -r exec pnpm version <patch|minor> --no-git-tag-version`,
   then commit + tag `v<x.y.z>` at the repo root.
4. **Build verify**: `pnpm build && node app/cli/dist/index.js --version`.
5. **Pack smoke test**: `pnpm -r pack` drops every tarball into the repo
   root (plus a pack-only `tau-tool-<ver>.tgz` for the private root —
   publish ignores it). In a scratch dir install the whole family at
   once — `npm install $(ls <repo>/tau-*.tgz | grep -v '/tau-tool-')` —
   then `tau --version`, `tau skill list`,
   `tau ask "find ts files" --yes` (mock provider needs no network). The
   published `@tau/skills` artifact MUST include `bundled/` and
   `templates/` — `tau skill new demo test` proves it. No packed manifest
   may still contain `workspace:` / `catalog:` specifiers.
6. **Publish**: `pnpm publish -r --access public --no-git-checks` from the
   repo root (maintainer/CI; npm scope `@tau` required). Push the tag.

Never publish with a dirty tree or failing gate.

## Daily changelog duty (AGENTS/collaboration.md §8)

While doing release prep (or any working day), record that day's changes in
`changelog/YYYY-MM-DD.md` at the repo root — summary, type (feature / fix /
refactor / docs / chore), Issue/PR refs, impact scope. One file per day;
never mix multiple days. `CHANGELOG.md` stays the release-level summary
extracted from these daily files.
