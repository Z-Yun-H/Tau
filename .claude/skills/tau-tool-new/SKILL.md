---
name: tau-tool-new
description: Add a new built-in tool to Tau (packages/tools) that passes tests and renders correctly in the AI catalog. Use when asked to add a tool, extend file/sys/net/text with a new operation, or fix a tool's registry/risk/docs wiring.
---

# Create a Tau tool (root router)

> **Layer note — this is a ROUTER, not the content.** The owning content of
> this workflow is the TOOL-LAYER skill
> [`packages/tools/SKILL.md`](../../../packages/tools/SKILL.md)
> (`tau-tools-authoring`, versioned with `@tau/tools`). Read that file for
> the full authoring guide: the `ToolDefinition` contract, arg helpers,
> risk semantics, dry-run rules, CLI wiring via `runToolDirect`, the
> pitfalls table, and the docs/tests checklist.

## Normative spec

[AGENTS/architecture.md](../../../AGENTS/architecture.md) defines the module
boundaries and the dual-use rule (CLI subcommand + AI planner catalog);
[docs/safety.md](../../../docs/safety.md) defines the risk model. Read them
before adding anything. Golden rule: no delete primitives, mutating tools
stay dry-run by default.

## Fast path (from the repo root)

```bash
pnpm dev -- file find "*.ts"        # run any existing tool from source
pnpm --filter @tau/tools test       # tools suite (vitest)
```

Then follow the 6-step fast path in `packages/tools/SKILL.md`.
