# @tau/core

Shared foundation for every Tau workspace package: the domain vocabulary, the
`TAU_HOME` path resolution, the JSON config store, and the JSONL command
history. Zero runtime dependencies — this is the bottom of the workspace
dependency graph.

## Public API

Everything is exported from the package barrel (`src/index.ts`):

- **Domain types** — `Plan`, `PlanStep`, `ToolDefinition`, `ToolParamSpec`,
  `ToolResult`, `SkillMeta`, `SafetyReview`, `SafetyIssue`, `RiskLevel`,
  `AIProvider`, `TauConfig`, `ModelInfo`, `HistoryEntry`, `PlanningContext`
- **Paths** (`src/config/paths.ts`) — `tauHome()`, `configPath()`,
  `historyPath()`, `userSkillsDir()`, `ensureHome()`
- **Config store** (`src/config/store.ts`) — `loadConfig()`/`saveConfig()`
  (file is `chmod 0600`), dotted-key `getConfigValue()`/`setConfigValue()`,
  `updateProviderEntry()`, `DEFAULT_CONFIG`, secret hygiene via
  `maskSecret()`/`redactConfig()`
- **History** (`src/config/history.ts`) — JSONL `appendHistory()`,
  `readHistory()`, `findHistoryEntry()`, `clearHistory()`

## Dependencies

- Runtime: none
- Workspace: none

## Development

```bash
pnpm --filter @tau/core build   # build this package only
pnpm test                       # tests live in tests/ (run workspace-wide)
```

See the [architecture rulebook](../../AGENTS/architecture.md) and the root
[README](../../README.md) for the big picture.
