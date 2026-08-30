# AGENTS/plugins.md — MCP plugin system rules

Read this before touching `src/plugins/`, `src/cli/plugin.ts`, or anything
MCP-related. The plugin system lets external MCP servers contribute tools to
Tau's planner catalog.

## Non-negotiables

1. **Plugin tools are always `risk: "medium"`.** Never map a plugin tool to
   low (there is no way to verify third-party side effects) and never to
   `blocked`/`high` unconditionally either — the reviewer escalates from
   actual plan context; the intrinsic level stays medium.
2. **No bypass of the pipeline.** Plugin tools execute via the tool registry
   → `executeStep` like every other tool. They must never spawn processes,
   open sockets, or touch the filesystem outside `client.callTool`.
3. **Failures degrade, never crash.** An unreachable server, a missing MCP
   SDK, a malformed tool list — all become warnings. `tau ask` proceeds with
   what it has. Only `tau plugin tools <name>` (explicit user intent) exits
   non-zero on failure.
4. **Dynamic import only.** The MCP SDK lives in `optionalDependencies` and
   is imported through variable specifiers (see `loadMcpSdk`), kept external
   by `deps.neverBundle` in `tsdown.config.ts`. A static import would break
   the no-optional-deps install path and drag the SDK into the bundle.
5. **No ambient secrets.** Stdio env extras come from explicit `--env` config
   and are layered over the SDK's default allowlist — never pass
   `process.env` wholesale. HTTP headers are opt-in per plugin.
6. **Name hygiene.** Plugin names are kebab-case and reserved-word-checked
   (`validatePluginName`); tool names are sanitized to `[A-Za-z0-9_-]` and
   deduplicated (`mcpToolsToDefinitions`). Final tool names are
   `plugin.<plugin>.<tool>` so the reviewer/catalog namespace stays unambiguous.

## Budgets (why they exist)

| Budget            | Value | Rationale                                            |
| ----------------- | ----- | ---------------------------------------------------- |
| connect handshake | 10 s  | bounded startup: a hung server must not stall `ask`  |
| tool call         | 120 s | generous for real tools, finite for runaway servers  |
| tool arguments    | 64 KB | runaway-generation guard before data leaves the host |

If you change these, update docs/plugins.md and the tests that assert the
messages.

## Testing rules

- The InMemory-transport tests (real SDK, no process) cover list/call/mapping.
- The stdio test spawns a REAL child MCP server and asserts env passing and
  the full `run()` closure (fresh connect → call → close). Keep it.
- Plugin CLI tests must clean up `$TAU_HOME` between cases (see
  `tests/integration/plugins-cli.test.ts`).

## Checklist for plugin-system changes

- [ ] New failure mode? → it degrades to a warning + has a test
- [ ] Touched `mcpToolsToDefinitions`? → risk stays medium, name sanitize
      still deduplicates, param mapping still total (no throws)
- [ ] Touched transports? → stdio AND http covered (InMemory covers neither)
- [ ] Budgets or messages changed? → docs/plugins.md + tests updated
- [ ] CHANGELOG entry under **Unreleased**
