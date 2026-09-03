# Built-in tools

Tau's tool layer is **deterministic**: every tool is a registry-driven function, AI plans may only call tools that exist in the registry, and nothing is invented at runtime. Four built-in families — read-only first, mutating operations dry-run by default.

## The file family

| Tool          | What it does                                                                                                                   | Risk   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------ |
| `file.find`   | recursive glob search (prunes node_modules/.git/dist)                                                                          | low    |
| `file.read`   | numbered text read (offset/limit, refuses binaries and >2MB; since v0.5.0 the structured result carries the detected language) | low    |
| `file.list`   | single-directory non-recursive listing                                                                                         | low    |
| `file.stat`   | size / type / mtime                                                                                                            | low    |
| `file.tree`   | depth-limited directory tree                                                                                                   | low    |
| `file.rename` | regex batch rename (dry-run by default)                                                                                        | medium |
| `file.write`  | controlled write (overwrite/append, dry-run default, workspace-contained)                                                      | medium |

**There is deliberately no delete.** The first-party family has no delete primitive — deleting goes through reviewed shell steps or your own hands. That is a design decision recorded in the safety model, not an omission.

## sys / net / text families

- **sys**: read-only system probes (processes, disk, environment).
- **net**: read-only network operations (HTTP GET and friends).
- **text**: find/count-style operations over file contents.

Every tool has a CLI command (`tau file read`, …) and its full parameter schema is browsable in the WebUI Tools panel.

## Risk and confirmation

A tool's declared `risk` drives the execution gate: low read-only tools run directly inside a plan; medium tools (writes) default to a dry-run preview and need `execute: true`; the safety reviewer re-checks every planned write path independently (defense in depth — the reviewer only ever strengthens the tool's own checks).

## file.read language metadata (v0.5.0)

The structured result now carries `path` and `language` — best-effort language detection from the file name (shiki-compatible id, honest `text` fallback). The WebUI file viewer picks its highlighter with the same detection; tool layer and frontend share one logic, kept in sync by a parity test.
