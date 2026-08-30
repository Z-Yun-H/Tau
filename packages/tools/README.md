# @tau/tools

The deterministic tool layer: an idempotent tool registry plus the built-in
`file.*`, `sys.*`, `net.*` and `text.*` tool families. AI plans may only call
tools that live here (or skill/plugin tools registered into the same
registry). Mutating operations default to dry-run; there is no delete
primitive.

## Public API

Everything is exported from the package barrel (`src/index.ts`):

- **Bootstrap** (`src/bootstrap.ts`) — `registerCoreTools()` registers every
  built-in tool family exactly once at import-call time (idempotent)
- **Registry** (`src/registry.ts`) — `registerTools()`, `getTool()`,
  `allTools()`, `resetRegistry()`, `renderToolCatalog()`
- **Tool families** — `fileTools` (find/stat/tree/rename/replace/...),
  `sysTools` (info/disk/proc), `netTools` (fetch with SSRF guard/ip/ping/
  port), `textTools` (count/search/replace)

Tool behavior contract: pure functions over `ToolDefinition` with typed
`ToolParamSpec` parameters; `net.fetch` refuses private/loopback/link-local
targets; `net.ping` rejects shell metacharacters; `file.find`/`file.tree`
prune `node_modules`.

## Dependencies

- Runtime: none
- Workspace: `@tau/core`

## Development

```bash
pnpm --filter @tau/tools build
pnpm test
```

Rulebooks: [architecture](../../AGENTS/architecture.md) — adding a tool op,
[dry-run defaults](../../AGENTS/conventions.md). Safety model:
[docs/safety.md](../../docs/safety.md).
