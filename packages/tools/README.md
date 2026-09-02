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
  `allTools()`, `resetRegistry()`, `renderToolCatalog()` (groups tools by
  family with `## family (N)` headers + per-tool `risk` / `mutates` /
  `dry-run-default` tags), `catalogSummary()` (one-line
  `N tools across M families (X read / Y mutates)` for the system prompt)
- **Tool families** — `fileTools` (read/list/find/stat/tree/rename —
  `rename` is `mutates + dryRunDefault`), `sysTools` (info/disk/proc/
  datetime/which/env — `env` is medium risk because environment values may
  hold secrets), `netTools` (fetch with SSRF guard/ip/ping/port),
  `textTools` (count/search/replace/hash — `replace` is
  `mutates + dryRunDefault`)

Tool behavior contract: pure functions over `ToolDefinition` with typed
`ToolParamSpec` parameters; the optional `mutates` / `dryRunDefault` flags
on `ToolDefinition` surface in the catalog so the planner can prefer
read-only + dry-run tools first (AGENTS/ai-integration.md rule 4-5).
`net.fetch` refuses private/loopback/link-local targets; `net.ping` rejects
shell metacharacters; `file.find`/`file.tree` prune `node_modules`.

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
