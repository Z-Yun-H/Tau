# @tau/webui

`tau-web` — the local web interface. A node HTTP API (`src/server.ts`,
zero-dependency `node:http`) plus a **Vue 3 + UnoCSS** client (`client/`,
built by vite). Both front doors — TUI and Web — drive the same
plan → review → confirm → `runPlan()` pipeline through `@tau/agent`.
Binds to 127.0.0.1; deny verdicts are refused server-side and high-risk
plans demand the explicit `confirmHighRisk` flag.

The visual language takes pixel-level reference from
[chat.z.ai](https://chat.z.ai/) — quiet restraint, fused sidebar, beam
composer, chrome-only accent, two-font system — adapted to Tau's
domain (plans, steps, tools, the deterministic risk model). The full
spec is [`DESIGN.md`](./DESIGN.md); the checklist is
[`SKILL.md`](./SKILL.md).

## Screenshots

Real end-to-end sessions: the actual server + client in headless
Chromium with the offline mock provider (regeneration:
[docs/screenshots/README.md](./docs/screenshots/README.md)):

**the reviewed plan — risk badge, steps, Run plan / Discard**

![webui plan](./docs/screenshots/plan.png)

**the streaming result — NDJSON events rendered live**

![webui result](./docs/screenshots/result.png)

## Client stack

- **Vue 3** — a slim shell (`client/App.vue`) over the component
  inventory in `client/components/` (StatusHeader with chrome `τ` brand
  mark, SessionSidebar with fused history rail + `+ new conversation`
  chrome primary, ShortcutsModal, PlanCard/StepRow with chrome `Run
plan`, ResultCard, ErrorCard, SidePanel with Skills/History/Tools,
  Composer with the beam + chrome Send, RiskBadge, EmptyState with
  serif headline); state lives in `client/composables/` (module
  singletons, no state library), HTTP in `client/lib/api.ts`, markdown
  via `@tau/markdown`
- **Agent mode** — the stream is a conversation: user bubbles +
  assistant turns (plan card, then result card in the same turn);
  threads persist to `localStorage` (server history stays the durable
  record); keyboard-first (Enter send / Shift+Enter newline / Ctrl+K
  focus / `?` shortcuts panel / Alt+N new thread / Alt+S rail toggle /
  Esc closes modal + drawer); markdown preview with rendered/raw
  toggle, copy and expand — rendered by the zero-dependency,
  escape-first `@tau/markdown`, never a sanitizer gap
- **UnoCSS** (`uno.config.ts`, `presetWind3`) — the design tokens (dark
  neutral ramp fused to the page bg + the risk palette as THE semantic
  system + the chrome sweep as the only gradient) and shared shortcuts;
  typography and motion tokens in `client/theme.css`
- **Design system**: "terminal precision" with a chat.z.ai-inspired
  quiet — data in mono, prose in sans, serif for the empty-state
  headline only; no gradients except the chrome sweep on the brand
  mark + Run plan; no glassmorphism; one shadow on the composer;
  responsive (≥1024px three-column rail, below that a single flow with
  sticky composer); restrained motion with `prefers-reduced-motion`
  support. Normative spec: [DESIGN.md](./DESIGN.md); checklist:
  [SKILL.md](./SKILL.md) (`tau-webui-design`)
- **Vite** (`vite.config.ts` client build → `dist/client/`;
  `vite.server.config.ts` node/SSR build of the server → `dist/index.js`
  with the `tau-bin-shebang` plugin keeping the bin executable)

The API server statically serves `dist/client/` when built, falling
back to the raw `client/` sources (dev/tests) — API shape and the
safety gates are identical in both modes. The `tau web` commander
wiring lives in `@tau/cli` (`app/cli/src/web.ts`); this package never
imports commander.

## Public API

- `startWebUi(options)` / `createRequestListener()` — node server entry
- bin `tau-web` (also `tau web` via the CLI)

HTTP surface: `GET /api/status` (provider, model, availability,
skill/plugin counts), `GET /api/skills` (with risk/origin),
`GET /api/tools` (the tool layer inventory: name/description/risk/owner/
params — pure data, never the executables), `GET /api/history` (`?limit=`
optional, default 20, cap 500), `POST /api/plan` (intent → plan +
deterministic review), `POST /api/execute` (request-as-approval; deny
→ 403, high risk requires `confirmHighRisk`), `POST /api/execute/stream`
(NDJSON streaming execution).

## Dependencies

- Runtime (node side): none beyond workspace packages
- Workspace: `@tau/core`, `@tau/engine`, `@tau/ai`, `@tau/skills`,
  `@tau/agent`, `@tau/markdown`
- Client (bundled): `vue`, `@vueuse/core`, `shiki`
- Build/dev only: `vite`, `@vitejs/plugin-vue`, `unocss`, `tsx`,
  `playwright-core` (for screenshot regen)

## Development

```bash
pnpm --filter @tau/webui build      # client + server builds
pnpm --filter @tau/webui dev        # vite dev server (:5173, proxies /api → :8787)
pnpm --filter @tau/webui dev:server # engine API server on :8787 (tsx from source)
pnpm dev:web                        # same API server from the repo root
pnpm --filter @tau/webui shots      # regenerate plan.png + result.png
```

No new execution channels: the WebUI is a front door, the engine is
the door.
