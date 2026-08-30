# @tau/webui

`tau-web` — a zero-dependency local web interface for Tau. A tiny `node:http`
server (no framework, no build step for the frontend) serving a vanilla
JS/HTML/CSS chat UI plus a JSON API over the same engine as every other UI.

## Run

```bash
pnpm dev:web                        # from source
tau web                             # from the built CLI (--port/--host flags)
```

Port `0` (default) picks a free port and the actual URL is printed.

## API surface

| Endpoint       | Method | Purpose                                       |
| -------------- | ------ | --------------------------------------------- |
| `/`            | GET    | static UI (`public/`)                         |
| `/api/status`  | GET    | version, provider, model, uptime              |
| `/api/skills`  | GET    | skill catalog                                 |
| `/api/history` | GET    | recent history entries                        |
| `/api/plan`    | POST   | plan an intent (returns the reviewed plan)    |
| `/api/execute` | POST   | execute a previously planned + confirmed plan |

## Safety model

- Every execute request is re-reviewed server-side (`reviewPlan()`);
  `deny` verdicts are refused with `403` — the client cannot bypass the gate
- High-risk plans require an explicit `confirmHighRisk: true` flag in the
  execute request
- Request bodies are capped (1 MB) and static paths are guarded against
  path traversal

## Public API

- `startWebUi()` / `RunningWebUi` / `StartWebUiOptions` — server lifecycle
- `createRequestListener()` — the HTTP handler (used by tests directly)
- `registerWebCommand()` — wires `tau web` into the CLI program

## Dependencies

- Runtime: none (node:http only)
- Workspace: `@tau/agent`, `@tau/engine`, `@tau/core`

## Development

```bash
pnpm dev:web
pnpm --filter @tau/webui build
pnpm test   # server tests cover the API + safety refusals
```
