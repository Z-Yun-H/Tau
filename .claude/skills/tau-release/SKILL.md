---
name: tau-release
description: Cut a Tau release: changelog, version bump, build verification, pack smoke test. Use when the maintainer asks to release or bump the version.
---

# Release Tau

Follow the full checklist in AGENTS/release.md. Short form:

1. **Gate**: `npm run lint && npm run typecheck && npm run test:cov` — all green.
2. **Changelog**: move `## Unreleased` entries to `## vX.Y.Z - YYYY-MM-DD`
   (Conventional Commits since last tag decide minor vs patch; breaking →
   minor until 1.0, with a **Breaking** header).
3. **Version**: bump the published package in place — run
   `npm version <patch|minor>` inside `app/cli/` (the `@tau/cli` package
   owns the `tau` bin and the release version; makes commit + git tag).
4. **Build verify**: `pnpm build && node app/cli/dist/index.js --version`.
5. **Pack smoke test** — currently BLOCKED, see issue #23 and the
   "Known gap" note in AGENTS/release.md: the packed `@tau/cli` tarball
   cannot be installed outside the workspace while its `@tau/*` runtime
   dependencies use the `workspace:*` protocol (`npm install` 404s on the
   unpublished scoped packages).
   The pack itself works: `pnpm pack` inside `app/cli/` produces
   `tau-cli-<ver>.tgz`. Once the gap is closed, the smoke test is:
   install the tarball in a scratch dir, then `tau --version`,
   `tau skill list`, `tau ask "find ts files" --yes` (mock provider needs no
   network). The published `@tau/skills` artifact MUST include `bundled/`
   and `templates/` — `tau skill new demo test` proves it.
6. **Publish**: `npm publish` (maintainer/CI) — blocked by the same gap.
   Push the tag.

Never publish with a dirty tree or failing gate.
