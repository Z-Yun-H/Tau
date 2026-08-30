# @tau/agent

The orchestration layer shared by every Tau UI (cli, tui, webui): it prepares
the tool/skill catalogs, resolves the provider, and turns a raw intent into a
reviewed plan — without owning any execution path.

## Public API

Everything is exported from the package barrel (`src/index.ts`):

- **Pipeline** (`src/pipeline.ts`) — `planIntent()` runs the shared
  intent → plan flow (resolve provider → prepare catalogs → provider.plan)
  and `prepareCatalog()` assembles the tool + skill catalog (including
  plugin tools); `ProviderUnavailableError` carries the actionable hint
  (e.g. run `tau provider set-key`)
- **Skill tools bridge** (`src/skill-tools.ts`) — `buildSkillTools()` maps
  skill commands into registry-compatible tool definitions so skills show up
  in the planning catalog of every UI

Both CLI (`tau ask`) and the interactive UIs (`tau tui`, `tau web`) go
through this package — adding a new UI means consuming `@tau/agent` and
`@tau/engine`, never opening a second execution channel.

## Dependencies

- Runtime: none
- Workspace: `@tau/core`, `@tau/tools`, `@tau/engine`, `@tau/ai`,
  `@tau/skills`, `@tau/plugins`, `@tau/ui`

## Development

```bash
pnpm --filter @tau/agent build
pnpm test
```

See the [architecture rulebook](../../AGENTS/architecture.md) for where this
package sits in the pipeline diagram.
