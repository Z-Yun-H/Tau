# @tau/plugins

The MCP (Model Context Protocol) plugin system: connect any MCP server —
dsh, VS Code, filesystem, anything speaking MCP — and its tools join the Tau
tool catalog under a strict safety contract.

## Public API

Everything is exported from the package barrel (`src/index.ts`):

- **Manager** (`src/manager.ts`) — CRUD over the persisted plugin list:
  `addPlugin()`, `removePlugin()`, `setPluginEnabled()`, `findPlugin()`,
  `validatePlugin()` / `validatePluginName()` (name/transport validation),
  `pluginEndpoint()`, `listPluginsText()`
- **MCP client seam** (`src/mcp.ts`) — `loadMcpSdk()` (dynamic import, the
  SDK is optional and never bundled), `handshake()`, `connectPluginClient()`,
  `listMcpTools()`, `callMcpTool()`, JSON-schema → `ToolParamSpec` mapping
  (`jsonTypeToParamType()`, `mcpToolsToDefinitions()`), `mcpResultToText()`,
  `MAX_PLUGIN_ARGS_BYTES` (64 KB args budget)
- **Runtime** (`src/runtime.ts`) — `loadPluginTools()` loads every enabled
  plugin's tools with full degradation: a single failing plugin produces a
  warning, never a crash

Safety contract: plugin tools are **always medium risk** — they go through
the full `reviewPlan()` gate like any other tool; env passed to plugin
servers is an allowlist, never the full `process.env`.

## Dependencies

- Runtime: none; optional `@modelcontextprotocol/sdk` (dynamic import,
  never bundled)
- Workspace: `@tau/core`, `@tau/tools`

## Development

```bash
pnpm --filter @tau/plugins build
pnpm test   # includes real stdio + in-memory MCP transport e2e tests
```

Rules and recipes (dsh bridge, VS Code): [AGENTS/plugins.md](../../AGENTS/plugins.md)
and [docs/plugins.md](../../docs/plugins.md).
