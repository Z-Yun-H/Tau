# @tau/skills

Skills are markdown, not code: `SKILL.md` files with YAML frontmatter that
extend Tau with read-only command shortcuts. This package owns the schema,
the three-tier loader (bundled → user → workspace), the manager behind
`tau skill ...`, and the bundled skills/templates assets.

## Public API

Everything is exported from the package barrel (`src/index.ts`):

- **Schema** (`src/schema.ts`) — `parseFrontmatter()`, `loadSkillFile()`
  (zod-validated frontmatter + safety scan of the body)
- **Loader** (`src/loader.ts`) — `scanSkills()`, `renderSkillCatalog()`,
  `skillSearchDirs()` — precedence: bundled, then `$TAU_HOME/skills`, then
  `<cwd>/skills` / `.tau/skills` (same-name skills shadow lower tiers)
- **Manager** (`src/manager.ts`) — `newSkill()` (scaffold from the bundled
  template), `validateSkill()`, `listSkills()`, `showSkill()`
- **Assets** (`src/assets.ts`) — `packageRoot()`, `bundledSkillsDir()`
  (`bundled/`), `templatesDir()` (`templates/`); resolution walks up to the
  nearest package.json so source (tsx/vitest) and bundled (dist) layouts both
  work

## Assets

- `bundled/` — skills shipped with Tau (`git-helper`, `docker-helper`, both
  read-only)
- `templates/` — scaffold source for `tau skill new` (read at runtime)

Both directories are listed in this package's `"files"` so they ship with the
npm artifact.

## Dependencies

- Runtime: `yaml`, `zod`
- Workspace: `@tau/core`, `@tau/engine`, `@tau/ui`

## Development

```bash
pnpm --filter @tau/skills build
pnpm test
```

Authoring guide: [docs/skills-authoring.md](../../docs/skills-authoring.md),
rules: [AGENTS/skills.md](../../AGENTS/skills.md).
