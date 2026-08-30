---
name: tau-release
description: Cut a Tau release: changelog, version bump, build verification, pack smoke test. Use when the maintainer asks to release or bump the version.
---

# Release Tau

Follow the full checklist in AGENTS.d/release.md. Short form:

1. **Gate**: `npm run lint && npm run typecheck && npm run test:cov` — all green.
2. **Changelog**: move `## Unreleased` entries to `## vX.Y.Z - YYYY-MM-DD`
   (Conventional Commits since last tag decide minor vs patch; breaking →
   minor until 1.0, with a **Breaking** header).
3. **Version**: `npm version <patch|minor>` (makes commit + git tag).
4. **Build verify**: `npm run build && node dist/index.js --version`.
5. **Pack smoke test**:
   ```bash
   npm pack
   # scratch dir:
   npm install -g ./tau-tool-<ver>.tgz
   tau --version && tau skill list && tau ask "find ts files" --yes
   npm uninstall -g tau-tool
   ```
   The pack MUST include templates/ — `tau skill new demo test` proves it.
6. **Publish**: `npm publish` (maintainer/CI). Push the tag.

Never publish with a dirty tree or failing gate.
