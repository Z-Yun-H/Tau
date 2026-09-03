# Plugins (MCP)

Tau can act as an **MCP host**: any server that speaks the
[Model Context Protocol](https://modelcontextprotocol.io) can plug its tools
into Tau's planner catalog, and those tools then run through the exact same
pipeline as built-ins — strict plan schema → deterministic safety review →
interactive confirmation → execution → history.

This is the integration path for external tool ecosystems:

- **dsh (DeepSeek Harness)** — expose harness capabilities as a tool server
- **VS Code** — editor bridges that speak MCP (open files, run tasks, read diagnostics)
- Everything else with an MCP server: filesystems, GitHub, databases, browsers, ...

## Concepts

| Concept     | In Tau                                                                           |
| ----------- | -------------------------------------------------------------------------------- |
| Plugin      | One configured MCP server in `$TAU_HOME/config.json` (`plugins` array)           |
| Transport   | `stdio` (Tau spawns a local process) or `http` (Streamable HTTP endpoint)        |
| Tool naming | `plugin.<name>.<tool>` — e.g. `plugin.dsh.status`, `plugin.files.list_directory` |
| Risk        | **Always `medium`** — see [security model](#security-model)                      |
| Discovery   | `tau plugin tools <name>` (manual) / automatic on every `tau ask`                |

## CLI

```bash
tau plugin list              # configured plugins (+ --json)
tau plugin add <name> -- <command...>          # stdio server
tau plugin add <name> --url <endpoint>         # http server
tau plugin add <name> --disabled             # register, don't connect
tau plugin tools <name>      # connect + list tools live
tau plugin enable|disable <name>
tau plugin remove <name>
```

Options for `add`:

- `--desc <text>` — human description (shown in `list`)
- `--cwd <dir>`, `--env KEY=VALUE` (repeatable) — stdio only; env extras are
  layered over the MCP SDK's safe default allowlist, never the full environment
- `--header KEY=VALUE` (repeatable) — http only, e.g. auth tokens

## Recipes

### Filesystem server (sanity check)

```bash
tau plugin add files -- npx -y @modelcontextprotocol/server-filesystem ~/project
tau plugin tools files
tau ask "在 ~/project 里列出所有目录"
```

### dsh (DeepSeek Harness)

dsh is a profile-based agent harness with its own plugin system. The wiring
pattern is the same for any harness CLI: run it (or a small bridge) as a
stdio MCP server, or point Tau at its HTTP endpoint if the deployment runs a
gateway:

```bash
# 1) stdio: a bridge script that adapts dsh CLI invocations to MCP tools
tau plugin add dsh --cwd ~/tools/dsh-bridge -- node bridge.mjs

# 2) http: a dsh gateway that exposes MCP on http
tau plugin add dsh --url http://127.0.0.1:8787/mcp --header AUTHORIZATION="Bearer $DSH_TOKEN"
tau plugin tools dsh
```

A 20-line bridge in Node (uses the same SDK Tau uses):

```js
// bridge.mjs — wrap ANY cli as an MCP tool server
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { execFile } from "node:child_process";

const server = new McpServer({ name: "dsh-bridge", version: "0.1.0" });
server.tool(
  "status",
  "dsh profile status",
  { profile: z.string().optional() },
  async ({ profile }) => {
    const out = await new Promise((resolve, reject) =>
      execFile("dsh", ["status", ...(profile ? [profile] : [])], (err, stdout) =>
        err ? reject(err) : resolve(stdout),
      ),
    );
    return { content: [{ type: "text", text: String(out) }] };
  },
);
await server.connect(new StdioServerTransport());
```

> Note: DeepSeek's official harness packages (`@deepseek-ai/dsh-*`) are
> release candidates whose dependency graph is not fully published yet
> (npm 404 on some peers as of this writing). The bridge pattern above works
> with the released `dsh` CLI and avoids pinning your Tau install to RC
> software. Revisit direct harness integration once the packages stabilize.

### VS Code

VS Code speaks MCP natively (agent mode). Two directions are useful:

- **Editor → Tau**: nothing to do — editors are hosts too; register Tau's
  binary as an MCP server in VS Code if you want `tau` tools inside the IDE.
- **Tau → editor**: point a plugin at an editor-side MCP bridge that exposes
  files/diagnostics/tasks, then drive it by intent:

```bash
tau plugin add vsvcode --url http://127.0.0.1:3000/mcp
tau plugin tools vsvcode
tau ask "打开当前工作区里 TODO 最多的文件并显示诊断"
```

Any bridge that speaks MCP works — the tool names in your catalog are
`plugin.vsvcode.<tool>`.

## Lifecycle & performance

- Discovery happens on **every `tau ask`**: Tau connects each enabled plugin
  with a 10 s handshake budget, lists tools, registers them, disconnects.
- A plugin tool **call** opens a fresh connection, runs the tool (120 s cap),
  and closes. Stateless by design — servers that need warm sessions should
  run in `http` mode behind a gateway.
- Failures degrade: an unreachable plugin prints a warning and `tau ask`
  continues with the remaining catalog. The MCP SDK itself is an
  `optionalDependencies` entry — without it, plugins are disabled with a
  clear hint and everything else works.

## Security model

1. **Plugin tools are always `medium` risk.** They are third-party code with
   first-party reach; the reviewer treats every step like a mutating
   operation: interactive confirm required, `--yes` only helps when
   `config allowMediumAutoApprove true` is set, and the plan-level caps apply
   (max 10 steps).
2. **No ambient secrets.** Plugin env vars are explicit (`--env`) and layered
   over the SDK's minimal default allowlist — the full process environment
   is never forwarded. HTTP headers are opt-in per plugin.
3. **Argument budget.** Tool arguments larger than 64 KB of JSON are refused
   before they reach a server (runaway-generation guard).
4. **Output discipline.** Plugin output flows through the same executor caps
   as built-ins and lands in history as plain text.
5. **Deny list still rules.** A plan that pairs a plugin tool with a blocked
   shell step is denied exactly like any other plan. `blocked` is blocked —
   plugins do not change that.

Configuration lives in `$TAU_HOME/config.json` under `plugins`; edit with
`tau plugin ...` commands or by hand (see `tau config path`).

## Skill or plugin?

|       | Skill                                    | Plugin                            |
| ----- | ---------------------------------------- | --------------------------------- |
| Shape | one SKILL.md document                    | separate tool-server process      |
| Tools | declarative commands (expand to intents) | real executable tools             |
| Risk  | declared, reviewed                       | always medium                     |
| Fits  | prompt injection, conventions            | real external system capabilities |

Zero-code injection → [skills](/en/guide/skills); real systems → plugins.

## Troubleshooting

When a plugin is unreachable, Tau degrades honestly: its tools drop out of the catalog with a note and the rest of the pipeline continues. `tau plugin list` shows availability; for network servers check the URL and auth env vars.
