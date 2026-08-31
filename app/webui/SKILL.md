---
name: tau-webui-design
version: 0.1.0
description: >
  Design system for the Tau WebUI client (app/webui/client). Use when
  building or changing any WebUI frontend surface: tokens, layout
  breakpoints, components, motion, and the avoid-AI-cliché rules.
author: Z-Yun-H
tags: [webui, frontend, design-system]
triggers: [webui, frontend, design, unocss, vue]
risk: low
---

# Tau WebUI design system ("terminal precision")

The WebUI is the web face of a terminal assistant. Its visual language is
derived from the product's domain — plans, steps, tools, and the risk model
— not from generic dashboard templates. When you touch anything under
`app/webui/client/`, these rules are normative.

## Token sources of truth

| Token kind                   | Lives in                           | Notes                                                     |
| ---------------------------- | ---------------------------------- | --------------------------------------------------------- |
| Colors                       | `uno.config.ts` `theme.colors.tau` | single source; utilities are generated from it            |
| Fonts + motion               | `client/theme.css` CSS vars        | `--font-ui`, `--font-mono`, `--t-fast/med/slow`, `--ease` |
| Spacing / radii / type sizes | inline Uno utilities               | 4px grid; radii 4/6/10px; sizes 10–14px                   |

Neutral ramp (dark): `bg` (page) → `panel` (surface) → `raised` (hover) →
`active`. Hairlines: `line` (subtle), `line-strong` (controls). Text:
`text` (primary), `muted` (secondary), `faint` (meta).

## The ONE semantic color system: risk

Every risk/verdict/status indicator goes through `components/RiskBadge.vue`:

- `low` / `ok` → `tau.ok` (green)
- `medium` / `warn` → `tau.warn` (amber)
- `high` / `failed` / `deny` → `tau.danger` (red)
- `blocked` / `cancelled` → `tau.blocked` (dim gray)

`tau.info` (blue) marks provider identity. `tau.ok` doubles as the single
brand accent — keep it scarce (primary buttons, tab indicator, focus ring);
never fill large surfaces with it. No other colors, no gradients.

## Avoid-AI-cliché rules (hard)

1. No gradients, no glassmorphism, no box-shadows. Hierarchy comes from the
   neutral ramp, hairlines, and typographic contrast.
2. No emoji as UI icons. Text tags in mono (`TOOL`, `SHELL`, `PLAN`) are the
   iconography.
3. Data renders in mono; prose renders in sans. Never the reverse.
4. Restraint over decoration: if an element doesn't carry information, delete
   it.
5. Keep copy concrete and English (the product's UI language), e.g. "high
   risk — run it", "nothing runs before Run plan".

## Layout contract

- `≥1024px` (`lg:`): grid `[minmax(0,1fr) 320px]` — chat column + reference
  rail, each independently scrollable, viewport-locked (`h-dvh` app shell).
- `<1024px`: one scrolling flow — chat, sticky composer, reference rail
  below (max 45vh).
- `<640px`: header drops the tauHome chip; `md:` chips hide.
- Page content is centered with `max-w-[1400px]`.

## Motion spec

- Micro-transitions: colors/borders only, `duration-120`, `ease-out`. No
  transform-on-hover for buttons.
- Entrances: `tau-enter` keyframes (fade + 6px rise, `--t-med`), staggered
  40ms per card, capped at 200ms.
- Tab indicator: equal-width tabs; slide via `translateX(index * 100%)`,
  `duration-180`. No DOM measuring.
- Running state: a single pulsing dot (`tau-pulse`) — never fake progress
  bars; execution has no streaming, so the UI must not pretend otherwise.
- `prefers-reduced-motion: reduce` disables all of it (global rule in
  theme.css). New animations must respect it automatically (use the
  keyframes/tokens, not ad-hoc CSS).

## Component inventory (client/components/)

- `StatusHeader` — identity + runtime facts; wraps on narrow screens.
- `EmptyState` — the contract text; keycap-styled control references.
- `RiskBadge` — the only place a risk level becomes color.
- `PlanCard` / `StepRow` — the review surface: steps on a rail, kind tags,
  `k="v"` args via `lib/format.ts formatArgs`, the AI's reason as secondary
  line, verdict banner, card-local high-risk checkbox (never a global DOM id).
- `ResultCard` — status badge, honest per-step tally, mono output block.
- `ErrorCard` — intent + message + the two concrete ways out.
- `SidePanel` — Skills / History / Tools tabs; sliding indicator; keyboard
  arrows; `role=tablist`.
- `Composer` — intent input; pending state in the button.

State: `composables/session.ts` (module-singleton refs — no state library)
and `composables/plan-flow.ts` (cards state machine). HTTP: `lib/api.ts`
(hand-mirrored server payloads; no runtime dependency on @tau/* — keep it
that way so the client bundle stays engine-agnostic).

## Backend surface rules

- The server (src/server.ts) exposes read-only GETs: `/api/status`,
  `/api/skills`, `/api/tools`, `/api/history`, plus `POST /api/plan` and
  `POST /api/execute` (the gated flow). New UI data goes through a session
  service in `@tau/agent` first; the UI only renders.
- `/api/tools` must stay pure data: name/description/risk/owner/params —
  never serialize the registry's `run` executables.

## Checklist for touching the WebUI

- [ ] New color? → `uno.config.ts` theme + this skill updated together
- [ ] New risk-bearing element? → via `RiskBadge`, no ad-hoc colors
- [ ] New animation? → uses `--t-*`/`--ease` tokens; respects reduced-motion
- [ ] Layout change? → verify all three breakpoints (build, run `tau web`,
      check ≥1024 / 640–1023 / <640)
- [ ] `pnpm build` in `app/webui` clean (zero unmatched-utility warnings)?
- [ ] Server payload changed? → `lib/api.ts` types + server tests updated
