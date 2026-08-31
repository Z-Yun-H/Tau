# @tau/webui

`tau-web` — the local web interface. A node HTTP API (`src/server.ts`,
zero-dependency `node:http`) plus a **Vue 3 + UnoCSS** client (`client/`,
built by vite). Both front doors — TUI and Web — drive the same
plan → review → confirm → `runPlan()` pipeline through `@tau/agent`.
Binds to 127.0.0.1; deny verdicts are refused server-side and high-risk
plans demand the explicit `confirmHighRisk` flag.

## Client stack

- **Vue 3** — a slim shell (`client/App.vue`) over the component inventory
  in `client/components/` (StatusHeader, PlanCard/StepRow, ResultCard,
  ErrorCard, SidePanel with Skills/History/Tools, Composer, RiskBadge,
  EmptyState); state lives in `client/composables/` (module singletons, no
  state library), HTTP in `client/lib/api.ts`
- **UnoCSS** (`uno.config.ts`, `presetWind3`) — the design tokens (neutral
  ramp + the risk palette as THE semantic system) and shared shortcuts;
  typography and motion tokens in `client/theme.css`
- **Design system**: "terminal precision" — data in mono, prose in sans, no
  gradients/shadows/emoji; responsive (≥1024px two-column rail, below that
  a single flow with sticky composer); restrained motion with
  `prefers-reduced-motion` support. Normative spec:
  [SKILL.md](./SKILL.md) (`tau-webui-design`)
- **Vite** (`vite.config.ts` client build → `dist/client/`;
  `vite.server.config.ts` node/SSR build of the server → `dist/index.js`
  with the `tau-bin-shebang` plugin keeping the bin executable)

The API server statically serves `dist/client/` when built, falling back to
the raw `client/` sources (dev/tests) — API shape and the safety gates are
identical in both modes. The `tau web` commander wiring lives in `@tau/cli`
(`app/cli/src/web.ts`); this package never imports commander.

## Public API

- `startWebUi(options)` / `createRequestListener()` — node server entry
- bin `tau-web` (also `tau web` via the CLI)

HTTP surface: `GET /api/status` (provider, model, availability, skill/plugin
counts), `GET /api/skills` (with risk/origin), `GET /api/tools` (the tool
layer inventory: name/description/risk/owner/params — pure data, never the
executables), `GET /api/history`, `POST /api/plan` (intent → plan +
deterministic review), `POST /api/execute` (request-as-approval; deny →
403, high risk requires `confirmHighRisk`).

## Dependencies

- Runtime (node side): none beyond workspace packages
- Workspace: `@tau/core`, `@tau/engine`, `@tau/ai`, `@tau/skills`, `@tau/agent`
- Build/dev only: `vite`, `vue`, `@vitejs/plugin-vue`, `unocss`, `tsx`
  (the client bundle is self-contained — vue ships inside `dist/client`)

## Development

```bash
pnpm --filter @tau/webui build      # client + server builds
pnpm --filter @tau/webui dev        # vite dev server (:5173, proxies /api → :8787)
pnpm --filter @tau/webui dev:server # engine API server on :8787 (tsx from source)
pnpm dev:web                        # same API server from the repo root
```

No new execution channels: the WebUI is a front door, the engine is the door.
