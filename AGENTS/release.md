# AGENTS/release.md — versioning & publishing

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

## What ships in the package (package.json "files")

- `dist/` built bundle
- `skills/` bundled skills
- `templates/` skill scaffold source (tau skill new reads it at runtime!)
- AGENTS.md + README.md

Careful: `templates/` is resolved relative to the package root at runtime via
`packages/core/src/config/paths.ts packageRoot()`. If you move it, update that function and
the smoke test above breaks — that's your signal.

## After release

- Push the tag
- Update README badge shields if versions appear in them
- Announce breaking changes in the GitHub release notes with migration steps
