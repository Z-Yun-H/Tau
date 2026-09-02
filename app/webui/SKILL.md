---
name: tau-webui-design
version: 0.2.0
description: >
  Design system checklist for the Tau WebUI client (app/webui/client).
  Use when building or changing any WebUI frontend surface: tokens,
  layout breakpoints, components, motion, and the avoid-AI-cliché
  rules. The normative visual spec is DESIGN.md (sibling file); this
  skill is the contract layer — test pins, server API, the keyboard
  map, and the pre-PR checklist.
author: Z-Yun-H
tags: [webui, frontend, design-system]
triggers: [webui, frontend, design, unocss, vue]
risk: low
---

# Tau WebUI design system — checklist & contract

The WebUI is the web face of a terminal assistant. Its visual language
is derived from the product's domain — plans, steps, tools, and the
risk model — not from generic dashboard templates. The pixel-level
reference is [chat.z.ai](https://chat.z.ai/) (its quiet restraint, fused
sidebar, beam composer, chrome-only accent, two-font system), adapted
to Tau's domain. When you touch anything under `app/webui/client/`,
these rules are normative.

> **Visual spec:** [`DESIGN.md`](./DESIGN.md) — colors, typography,
> layout, component anatomy, motion. This file is the _checklist_;
> DESIGN.md is the _spec_. When they disagree, DESIGN.md wins for
> visual matters; this file wins for contract matters (test pins,
> server API).

## Token sources of truth

| Token kind                   | Lives in                           | Notes                                                                                       |
| ---------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------- |
| Colors (both themes)         | `client/theme.css` CSS vars        | `--tau-*` on `:root` (dark default) + `html[data-theme="light"]` — the single source        |
| Color → utility map          | `uno.config.ts` `theme.colors.tau` | every `tau.*` maps to `var(--tau-*)`; class names are theme-independent, never raw hex      |
| Fonts + motion               | `client/theme.css` CSS vars        | `--font-sans`, `--font-mono`, `--font-serif`, `--t-fast/med/slow`, `--ease`, `--beam-angle` |
| Elevation                    | `client/theme.css` CSS vars        | `--tau-elev-1/2/3`, `--tau-edge-gradient`, `--tau-backdrop` — tuned per theme               |
| Theme state                  | `client/lib/theme.ts`              | `'light'                                                                                    | 'dark' | 'system'`persisted in`tau-webui-theme-v1`; boot script twin in index.html |
| Spacing / radii / type sizes | inline Uno utilities               | 4px grid; radii 4/6/8/12px; sizes 10–28px                                                   |

Neutral ramps (dark + light, same structure): `bg` (page) → `panel`
(surface) → `raised` (hover) → `active`. `line` / `line-strong` are for
small CONTROLS only (inputs, buttons, chips, kbd) — section separators
and surface outlines use `.tau-surface*` + `.tau-divider` instead; a
bare 1px hairline on a flat fill is a design bug in BOTH themes.
Text: `text` (primary), `muted` (secondary), `faint` (meta),
`placeholder` (textarea).

## The ONE semantic color system: risk

Every risk/verdict/status indicator goes through `components/RiskBadge.vue`:

- `low` / `ok` → `tau.ok` (green) — also the brand accent
- `medium` / `warn` → `tau.warn` (amber)
- `high` / `failed` / `deny` → `tau.danger` (red)
- `review` → `tau.info` (blue) — in-flight, not a verdict
- `blocked` / `cancelled` → `tau.blocked` (dim gray)

`tau.info` (blue) marks provider identity AND the `tool` step kind tag
AND the streaming `review` sentinel. `tau.ok` doubles as the single
brand accent — keep it scarce (primary buttons, tab indicator, focus
ring); never fill large surfaces with it.

## Accent — chrome (the ONLY gradient)

A 9-stop metallic sweep (`tau.chrome-1` … `tau.chrome-9`), used in
exactly two places:

1. The `τ` brand mark in the header (text via `background-clip:text`).
2. The `Run plan` button on the PlanCard (the chrome primary action —
   visually marks "this is the gate control").

Never on data surfaces, never on hover states, never on borders. This
is the _only_ gradient in the system; everything else is matte.

## Avoid-AI-cliché rules (hard)

1. **No gradients** — except the chrome sweep on the brand mark and the
   `Run plan` primary action. That is the _only_ gradient.
2. **No glassmorphism** — no `backdrop-filter` anywhere.
3. **Shadows** — only the composer's `0 4px 16px rgba(0,0,0,0.18)`.
   Nothing else gets a shadow.
4. **No emoji as UI icons.** Text tags (`TOOL`, `SHELL`, `PLAN`,
   `RESULT`, `ERROR`) in mono are the iconography. `▶` and `✕` are
   geometric glyphs, not emoji.
5. **Data in mono, prose in sans.** Never the reverse. Serif is for the
   empty-state headline only.
6. **Restraint over decoration.** If an element doesn't carry
   information, delete it.
7. **Copy is concrete and English.** "high risk — run it", "nothing
   runs before Run plan", "the safety review denied this plan".

## Layout contract

- `≥1024px` (`lg:`): grid — chat threads (`260px`, left) + chat column
  (`minmax(0,1fr)`, composer max-w-768 centered) + reference rail
  (`320px`, `Alt+S`-toggleable), each independently scrollable,
  viewport-locked (`h-dvh` app shell).
- `<1024px`: one scrolling flow — chat, sticky composer, reference rail
  below (max 45vh). The thread list becomes an overlay drawer behind the
  `≡ chats` button (backdrop click / selecting a thread / Esc closes it).
- `<640px` (`sm:` and below): header drops the tauHome chip and the
  skills/plugins count chip; empty-state serif headline shrinks 28→22px.
- Page content is centered with `max-w-[1600px]`.

## Keyboard contract

Global (App.vue `keydown`): Enter send · Shift+Enter newline ·
`Ctrl/⌘+K` focus composer · `?` opens ShortcutsModal (composer empty) ·
`Alt+N` new thread · `Alt+S` toggles the rail · Esc closes the modal
_and_ the sidebar drawer. The contract is documented in ShortcutsModal
and the composer hint row — if you add a shortcut, update both, and
keep every binding browser-safe (never intercept browser-reserved
chords like Ctrl+T/W/N).

## Motion spec

- Micro-transitions: colors/borders only, `duration-120`, `ease-out`. No
  transform-on-hover for buttons.
- Entrances: `tau-enter` keyframes (fade + 6px rise, `--t-med`),
  staggered 40ms per card, capped at 200ms.
- Tab indicator: equal-width tabs; slide via `translateX(index * 100%)`,
  `duration-180`. No DOM measuring.
- Composer beam: rotating conic-gradient border on focus-within
  (`tau-beam` keyframes, 3s linear infinite). Reduced-motion → static
  `tau.ok` border.
- Running state: a single pulsing dot (`tau-pulse`) — never fake
  progress bars.
- Chrome shimmer: `Run plan` hover slides the sweep
  (`background-position` shift, `--t-slow`).
- `prefers-reduced-motion: reduce` disables all of it (global rule in
  theme.css). New animations must respect it automatically (use the
  keyframes/tokens, not ad-hoc CSS).

## Component inventory (client/components/)

- `StatusHeader` — slim 48px top bar; `τ` brand mark in chrome text;
  provider chip (info accent); skills/plugins count chip (md+); version
  - tauHome chips; theme cycle button (☀/☾ + `auto`/`light`/`dark`,
    Alt+T). Closed by a gradient divider (`::after`), not a hairline.
- `SessionSidebar` — layered history rail (`.tau-surface` dock +
  `.tau-divider` separators); `+ new conversation` chrome primary
  action full-width at top; thread rows (active = tau.active);
  two-step inline delete (arm, then confirm — no `window.confirm`);
  drawer on narrow screens; footer kbd hint.
- `ShortcutsModal` — the keyboard contract overlay (Esc/backdrop
  closes).
- `EmptyState` — serif headline ("What can Tau do for you?") + contract
  prose + pipeline mono + kbd hints.
- `RiskBadge` — the only place a risk level becomes color.
- `PlanCard` / `StepRow` — the review surface: `Run plan` chrome
  primary action (the gate control), steps on a numbered rail, kind
  tags (`TOOL` info / `SHELL` warn), `k="v"` args via
  `lib/format.ts formatArgs`, the AI's reason as secondary line,
  verdict banner, card-local high-risk checkbox (never a global DOM id).
- `ResultCard` — status badge, honest per-step tally, output block with
  a rendered/raw preview toggle (markdown via `@tau/markdown`, escaped
  first), one-click copy, expand/collapse. `review` sentinel for
  streaming.
- `ErrorCard` — intent + message + the two concrete ways out.
- `SidePanel` — Skills / History / Tools tabs; sliding `tau.ok`
  indicator; keyboard arrows; `role=tablist`. The Tools tab leads with a
  catalog overview row (`N tools · N read · N mutates · N dry-run`), family
  groups with counts, and per-tool `READ`/`MUT`/`DRY` kind tags so the user
  sees the catalog shape at a glance (main info first). The `mutates` /
  `dryRunDefault` fields flow from `ToolDefinition` → `listToolSummaries()` →
  `/api/tools` → client `ToolSummary` → `groupTools()` → SidePanel; the
  `/api/tools` body still never contains `"run"` (test-pinned).
- `Composer` — the beam: rounded panel + soft shadow + rotating conic
  beam border on focus-within; auto-growing textarea; Enter/Shift+Enter
  semantics; hint row with live shortcuts; chrome Send button (disabled
  = raised gray, ready = chrome sweep); exposes `focus()` for Ctrl/⌘+K.
  The Send button is NOT labeled "Plan" — the composer _sends an
  intent_; the plan card _runs the plan_.

State: `composables/session.ts` (module-singleton refs — no state
library) and `composables/plan-flow.ts` (thread + cards state machine,
persisted to `localStorage` as a UI convenience — the server history
stays the durable record). HTTP: `lib/api.ts` (hand-mirrored server
payloads; no runtime dependency on @tau/* — keep it that way so the
client bundle stays engine-agnostic). Markdown preview: `@tau/markdown`
(the SHARED escape-first renderer — never introduce an
HTML-sanitization gap here; fenced code carries `data-lang` for the
highlighter). Streaming: `lib/stream.ts` (DOM-free NDJSON line-buffer,
unit-tested) consumed by plan-flow's execute path — a live result card
appears immediately and grows with `step_output` chunks; the final
`result` event is authoritative. Highlighting: `lib/highlight.ts`
(shiki, one shared highlighter, progressive in-place upgrade, silent
no-op on any failure — plain text is always a valid final state).
vueuse is the sanctioned client-utility layer: useClipboard (copy),
useEventListener + watchDebounced (global keys, streaming autoscroll).

## Backend surface rules (test-pinned, byte-level — DO NOT BREAK)

The server (`src/server.ts`) exposes:

- `GET /api/status` — provider, model, availability, skill/plugin counts
- `GET /api/skills` — with risk/origin
- `GET /api/tools` — name/description/risk/owner/params — **pure data,
  NEVER serialize the registry's `run` executables** (the body must not
  contain the literal `"run"`)
- `GET /api/history` — `?limit=` optional, default 20, cap 500
- `POST /api/plan` — intent → plan + deterministic review
- `POST /api/execute` — request-as-approval; deny → 403, high risk
  requires `confirmHighRisk`
- `POST /api/execute/stream` — NDJSON: the same deterministic gates
  refuse deny/high-risk plans as **plain JSON** (never a stream); a 200
  stream mirrors `runPlan`'s `onEvent` lifecycle events line by line
  (`step_start` → `step_output`* → `step_end` → `plan_end` → `result`)
  and ends with an authoritative `result` event

NDJSON event field names: `type`, `index`, `step`, `chunk`, `ok`,
`exitCode`, `skipped`, `status`, `output`, `outcomes`, `error`. The
`result` event is authoritative — it overwrites the incremental view.
403 as plain JSON (not NDJSON) for deny / high-risk-without-confirm.
`/api/tools` body must never contain the literal `"run"`.

localStorage: keys `tau-webui-threads-v1` (threads, pinned) and
`tau-webui-theme-v1` (`'light'|'dark'|'system'`, additive) —
`MAX_THREADS = 50`, `TITLE_CAP = 42`. Screenshot selectors: `textarea`,
`"Run plan"` button text, `"file.find in"` output prefix.

## Checklist for touching the WebUI

- [ ] New color? → a `--tau-*` var with BOTH a dark and a light value in
      `theme.css` (mapped in `uno.config.ts`) + DESIGN.md + this skill
      updated together. No raw hex in components.
- [ ] New risk-bearing element? → via `RiskBadge`, no ad-hoc colors
- [ ] New gradient? → **stop** — only the chrome sweep (brand mark +
      chrome buttons) and the structural edge/divider gradients are
      allowed. Justify or remove.
- [ ] New shadow? → **stop** — only the `--tau-elev-1/2/3` tokens.
      Justify or remove.
- [ ] New separator/outline? → `.tau-surface*` / `.tau-divider` — a
      bare 1px hairline on a flat fill is a design bug
- [ ] New animation? → uses `--t-*`/`--ease` tokens; respects
      reduced-motion
- [ ] Theme change? → verify BOTH themes (dark + light screenshots),
      the `Alt+T` cycle, and the no-flash boot behavior
- [ ] Layout change? → verify all three breakpoints (build, run
      `tau web`, check ≥1024 / 640–1023 / <640)
- [ ] `pnpm --filter @tau/webui build` clean (zero unmatched-utility
      warnings)?
- [ ] `pnpm test app/webui` green (5 files — byte-level snapshots
      preserved)?
- [ ] Server payload changed? → `lib/api.ts` types + server tests
      updated
- [ ] `Run plan` button text and `file.find in` output prefix
      unchanged (screenshot selectors)?
- [ ] localStorage key `tau-webui-threads-v1` unchanged?
