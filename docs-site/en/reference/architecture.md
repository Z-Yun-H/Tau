# Architecture overview

Tau is a pnpm workspace monorepo: `packages/` holds the capability layers, `app/` the front doors — all TypeScript ESM. The core principle is **one-way dependencies**: front doors depend on capability layers, and capability layers depend only downward.

## Package layout

```
packages/
  core/      types, config, tool registry contracts (ToolDefinition / ToolResult)
  tools/     deterministic tool layer: file/sys/net/text families
  engine/    execution & safety: reviewPlan() + runPlan() (the only channel)
  ai/        provider abstraction: AIProvider + seven implementations + streaming wire layer
  skills/    skill runtime + bundled user-facing skills (product content)
  plugins/   MCP client layer (plugin tools are ALWAYS medium risk)
  agent/     orchestration: catalog assembly + planning pipeline shared by ask/goal
  ui/ markdown/  terminal render primitives / dual-form markdown (HTML + ANSI)
app/
  cli/ tui/ webui/   three front doors, one engine, one gate
```

## The core pipeline

```
intent → provider.plan() → validatePlanResponse() (zod strict JSON)
       → reviewPlan() (deterministic safety review) → user approval → runPlan() (only channel)
```

Three invariants: (1) the AI never grades itself — review is deterministic code; (2) `runPlan()` is the only execution channel, no bypass; (3) plans are strict JSON — loose output is rejected.

## The streaming layer (v0.5.0)

`packages/ai/src/chat-stream.ts` is the unified streaming wire layer: four wire protocols (OpenAI SSE, Anthropic Messages SSE, Gemini `alt=sse`, Ollama NDJSON) collapse into provider-agnostic `ProviderStreamEvent`s (`reasoning_delta` / `text_delta` / `usage`). The agent layer (`planIntentStream`, `runGoal`'s `onPlanStream`) and the WebUI (`/api/plan/stream`, thinking panels) consume the same event shapes, relaying layer by layer without re-invention.

## Directory governance

The repo enforces where things live (see the directory governance table in `AGENTS/architecture.md`): AI behavior docs at root (`AGENTS*`); cross-cutting dev skills in `.claude/skills/`; single-package skills next to the code they govern; shipped user skills are product content (runtime data) under `packages/skills/bundled/`; the docs site is its own private workspace member, `docs-site/`.
