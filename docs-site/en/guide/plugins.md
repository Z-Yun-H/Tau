# Plugins (MCP)

Plugins connect external tool servers to Tau: through the Model Context Protocol (MCP), any server implementing the protocol registers its tools into Tau's tool registry where AI plans can call them.

## Basic usage

```bash
tau plugin add <command-or-url>   # register an MCP server
tau plugin list                   # inspect registered plugins
```

Tau ships an MCP client layer (`@tau/plugins`) that talks stdio/HTTP. Plugin tools appear in the catalog prefixed by their plugin and share the same plan → review → execute pipeline as built-ins.

## Safety rule: plugin tools are ALWAYS medium risk

This is a deliberate floor: Tau cannot audit the internals of an external server, so plugin tools are graded **medium unconditionally** — they can never silently auto-execute and always face the same confirmation gate as write operations. Plugins extend the capability surface, not the trust surface.

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
