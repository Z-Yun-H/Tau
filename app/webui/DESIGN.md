# Tau WebUI — Design Specification

> **Pixel-level reference:** [chat.z.ai](https://chat.z.ai/) — its quiet
> restraint, fused sidebar, beam composer, chrome-only accent, and
> two-font system. We adapt its _language_ to Tau's _domain_: plans,
> steps, tools, and the deterministic risk model.
>
> **Status:** normative for everything under `app/webui/client/`. Pairs
> with `SKILL.md` (`tau-webui-design`) — SKILL is the _checklist_, this
> file is the _spec_. When they disagree, this file wins for visual
> matters; SKILL wins for contract matters (test pins, server API).

---

## 1. Design philosophy

Tau is a **terminal assistant**, not a chatbot. Its UI must surface what
makes the product _safe_ — the deterministic gate between intent and
execution — without burying it under chat-theatre. Three principles:

1. **Quiet, not loud.** Like chat.z.ai, the surface is a matte neutral
   with one ornamental accent (chrome) reserved for the brand mark and
   the primary action. Hierarchy comes from typography and hairlines,
   never from shadows or gradients on data surfaces.
2. **Plans are first-class.** A plan is not a chat message — it is a
   contract the user must review. Plan cards get visual weight (left
   rail, numbered steps, verdict badge, Run plan as the chrome primary
   action) that user bubbles and result cards do not.
3. **The gate is visible.** "Nothing runs before Run plan" is the
   product's promise. Every screen makes the gate legible: empty state,
   plan card, shortcuts modal, result card — all reference the same
   control.

## 2. Token sources of truth

| Token kind             | Lives in                           | Notes                                                                            |
| ---------------------- | ---------------------------------- | -------------------------------------------------------------------------------- |
| Colors                 | `uno.config.ts` `theme.colors.tau` | single source; utilities generated from it                                       |
| Fonts + motion         | `client/theme.css` CSS vars        | `--font-sans`, `--font-mono`, `--font-serif`, `--t-*`, `--ease`, `--ease-spring` |
| Spacing / radii / type | inline Uno utilities               | 4px grid; radii 4/6/8/12px; sizes 10–60px                                        |

## 3. Color system — "dark, fused, restrained"

Dark is the default (pinned by tests + the product's terminal lineage).
A light variant is _not_ shipped in this revision.

### Neutral ramp (dark)

| Token             | Hex       | Role                                                                       |
| ----------------- | --------- | -------------------------------------------------------------------------- |
| `tau.bg`          | `#0B0E13` | page background — the canvas                                               |
| `tau.panel`       | `#0E1219` | sidebar / cards / composer shell — _fused_ with bg, separated by hairlines |
| `tau.raised`      | `#141A24` | hover surface, dropdowns, raised controls                                  |
| `tau.active`      | `#1B2331` | active thread, pressed state, focus-within tint                            |
| `tau.line`        | `#1B2230` | subtle hairline (card edges, dividers)                                     |
| `tau.line-strong` | `#28303F` | control borders, focus-adjacent borders                                    |
| `tau.text`        | `#E6EBF2` | primary text                                                               |
| `tau.muted`       | `#9AA5B4` | secondary prose, descriptions                                              |
| `tau.faint`       | `#5C6776` | meta (timestamps, kbd hints, placeholder)                                  |
| `tau.placeholder` | `#3F4856` | textarea placeholder (deliberately dimmer than `faint`)                    |

The sidebar is _visually fused_ with the app bg — both sit on
`tau.panel`/`tau.bg` adjacent tones — and is separated only by a single
`tau.line` 1px border. This is the chat.z.ai move; it makes the sidebar
read as a quiet rail, not a competing surface.

### Semantic system — risk (unchanged contract)

| Level                      | Token         | Hex       | Meaning                         |
| -------------------------- | ------------- | --------- | ------------------------------- |
| `low` / `ok`               | `tau.ok`      | `#5EC97A` | safe, success, the brand accent |
| `medium` / `warn`          | `tau.warn`    | `#E0A53C` | caution, plugin tools           |
| `high` / `failed` / `deny` | `tau.danger`  | `#E5534B` | blocked, failed, denied         |
| `blocked` / `cancelled`    | `tau.blocked` | `#6E7887` | dim gray                        |

Risk colors flow **only** through `RiskBadge.vue`. Never use `tau.ok` on
a large fill — it doubles as the brand accent (primary buttons, focus
ring, tab indicator) and must stay scarce.

### Accent — chrome (new, ornamental)

| Token                           | Hex                               | Role                                         |
| ------------------------------- | --------------------------------- | -------------------------------------------- |
| `tau.chrome-1` … `tau.chrome-9` | `#191A1D` → `#A8AAB8` → `#191A1D` | 9-stop sweep for the Run plan primary action |

A single metallic gradient, used in exactly two places, with two
treatments sized to the surface:

1. **The `τ` brand mark** in the header — a vertical metallic sheen
   (`#d4d6dc → #a8aab8 → #747689`, top to bottom) via
   `background-clip:text`, with a drop-shadow for depth. The full sweep
   does not read on a single narrow glyph, so the brand uses a bright
   vertical gradient + glow on hover instead.
2. **The `Run plan` button** on the PlanCard — the full 9-stop
   horizontal chrome sweep (`#191a1d → #a8aab8 → #191a1d`), large enough
   to show the dark→bright→dark transit clearly. This is the chrome
   primary action — visually marks "this is the gate control."

Never on data surfaces, never on hover states (except the brand glow),
never on borders. This is the _only_ gradient in the system; everything
else is matte.

### Provider identity

| Token      | Hex       | Role                                |
| ---------- | --------- | ----------------------------------- |
| `tau.info` | `#6BB3D9` | provider name chip, `tool` step tag |

## 4. Typography — two-font system

Inspired by chat.z.ai's Geist + Crimson Text + GeistMono stack, adapted
to Tau's terminal lineage with system fonts as the fallback (no web
font fetch — keeps the bundle self-contained per AGENTS/conventions.md).

```css
--font-sans:
  "Inter", system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei",
  sans-serif;
--font-mono:
  "JetBrains Mono", "Geist Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono",
  monospace;
--font-serif: "Crimson Text", "Iowan Old Style", Georgia, serif;
```

| Role                     | Family | Size | Weight                            | Line-height | Used for                             |
| ------------------------ | ------ | ---- | --------------------------------- | ----------- | ------------------------------------ |
| Body / UI                | sans   | 13px | 400                               | 1.55        | default text, labels, buttons        |
| Meta / mono              | mono   | 11px | 400                               | 1.5         | tool names, args, paths, output, kbd |
| Section eyebrow          | mono   | 10px | 500, tracking `0.08em`, uppercase | 1.4         | `plan` / `result` / `error` labels   |
| Card heading             | sans   | 14px | 600                               | 1.4         | step tool name, history title        |
| Hero / brand             | mono   | 18px | 500                               | 1.2         | `τ tau` in header                    |
| Hero serif (empty state) | serif  | 28px | 400, tracking `-0.5px`            | 1.25        | empty-state headline                 |

**Data in mono, prose in sans — never the reverse.** This is the
terminal-precision rule and it stays.

## 5. Layout contract

Three breakpoints, mobile-first.

### ≥1024px (`lg:`) — three-column grid, viewport-locked

```
┌──────────────────────────────────────────────────────────────────────┐
│ StatusHeader (h=48px, fused with bg, bottom hairline)                │
├──────────┬───────────────────────────────────────┬───────────────────┤
│          │                                       │                   │
│ Session  │  Conversation stream                  │  SidePanel        │
│ Sidebar  │  (scrollable)                         │  (skills/history/ │
│ 260px    │                                       │   tools tabs)     │
│ fixed    │                                       │  320px, Alt+S     │
│          │  ─ user bubble                        │  toggleable       │
│          │  ─ PlanCard (chrome Run plan)         │                   │
│          │  ─ ResultCard                         │                   │
│          │                                       │                   │
│          │  ┌─────────────────────────────────┐  │                   │
│          │  │ Composer (max-w 768px centered) │  │                   │
│          │  └─────────────────────────────────┘  │                   │
└──────────┴───────────────────────────────────────┴───────────────────┘
```

- App shell `h-dvh`, viewport-locked. Each column scrolls independently.
- Content max-width `1600px`, centered.
- Sidebar 260px (was 240 — gives history titles room).
- When rail closed: 2-col `260px | minmax(0,1fr)`.
- Composer max-width 768px, centered inside the conversation column —
  matches the chat column's visual focus on the active turn.

### 640–1023px (`md:`) — two-column with overlay sidebar

- Sidebar becomes an overlay drawer (`fixed inset-y-0 left-0 w-[280px]`,
  `-translate-x-full` when closed), backdrop `bg-black/55`.
- A `chats` button (top-left of the chat column) opens the drawer.
- SidePanel moves below the chat, `max-h-[45vh]`.
- Composer is sticky at the bottom of the chat column
  (`position: sticky; bottom: 0; bg-tau-bg`).

### <640px (`sm:` and below) — single flow

- Sidebar drawer stays (now full-width 280px).
- StatusHeader drops the `tauHome` chip and the skills/plugins count
  chip; only brand + provider + version remain.
- Composer fills width with 12px side gutters; textarea min-height
  drops to 44px.
- SidePanel goes full-width below the chat.
- Empty-state hero serif headline shrinks 28px → 22px.

## 6. Component anatomy

### 6.1 StatusHeader — slim top bar (48px)

A single row, `h-12`, fused with the app bg, bottom hairline
`border-b border-tau-line`. Three zones:

```
[ τ tau ]      [provider chip ▾] [skills·plugins]        [v0.2.0] [~/​.tau]
   ↑                ↑                ↑                        ↑        ↑
 chrome brand  info accent       meta (md+)              meta     meta (sm+)
```

- Brand: `τ` in chrome-text (background-clip), `tau` in `tau.text` 18px
  mono 500. Hovering the brand does nothing — it is identity, not a
  control.
- Provider chip: `tau-chip` with provider name in `tau.info` and model
  in `tau.faint`, separated by a thin dot. Title attribute shows the
  availability source.
- Skills·plugins chip (hidden <640px): mono count.
- Version chip: mono, `tau.faint`.
- tauHome chip (hidden <640px): mono, truncated, `tau.faint`.

### 6.2 SessionSidebar — fused history rail (260px)

```
┌────────────────────────────────┐
│ + new conversation      (chrome│  ← primary action, full width
├────────────────────────────────┤
│ find all ts files under sr…    │  ← active thread (tau.active bg,
│ 3 cards · 5m ago            ✕  │     tau.line-strong border)
│                                │
│ ping example.com               │  ← thread row (hover: tau.raised)
│ 1 card · 1h ago             ✕  │
│                                │
│ …                              │
└────────────────────────────────┘
```

- Header: `+ new conversation` chrome-primary button, full width, 36px
  tall. Replaces the old `+ new` corner button.
- Thread rows: 6px gutter inside the panel, `rounded-8px`, hover
  `tau.raised`, active `tau.active` + `tau.line-strong` border.
- Each row: title (sans 13px, truncate, single line) + meta (mono 10px
  `tau.faint`: `N cards · relTime`).
- Two-step inline delete (preserved contract): `✕` arms → `del?`
  confirms. No `window.confirm`. The armed state colors the button
  `tau.danger`.
- Empty state: `no conversations yet` in `tau.faint` mono 11px.
- Footer (optional, hidden when >0 threads): keyboard hint
  `Alt+N` new · `Ctrl+K` focus.

### 6.3 Composer — the beam (chat.z.ai-inspired)

The composer is the visual focus of the empty conversation. It is a
single rounded panel (`rounded-12px`, `tau.panel` bg, `tau.line-strong`
border, soft shadow `0 4px 16px rgba(0,0,0,0.18)` — the _one_ shadow in
the system, lifted directly from chat.z.ai's composer elevation).

```
┌──────────────────────────────────────────────┐
│  Describe what you want Tau to do…           │  ← textarea, 14px sans,
│                                              │     placeholder tau.placeholder
│                                              │
├──────────────────────────────────────────────┤
│ ⌘K focus · ? shortcuts       │ ▢ dry-run │ ▶ │  ← toolbar
└──────────────────────────────────────────────┘
```

- **Beam border on focus**: when the textarea has focus-within, the
  panel gains a 1px conic-gradient rotating border (the
  `--beam-angle` `@property` trick from chat.z.ai). The beam uses the
  chrome sweep at low alpha so it reads as "this is alive" without
  being loud. Off-focus: plain `tau.line-strong` border.
- **Textarea**: borderless, transparent bg, 14px sans, min-h 44px,
  max-h 160px, auto-grow. Enter sends, Shift+Enter newlines,
  `isComposing` respected (IME).
- **Toolbar** (`h-10`, top hairline `tau.line`):
  - Left: kbd hints (`⌘K focus` · `? shortcuts`) in mono 10px
    `tau.faint`, dotted-underlined when clickable.
  - Right: the **Send button** — a 28×28 square, `rounded-8px`. Disabled
    state: `tau.raised` bg, `tau.faint` text. Enabled state: chrome
    sweep bg, dark `▶` icon. Hover: brighten the sweep
    (`background-position` shift).
- **Sticky on narrow screens**: `position: sticky; bottom: 0;
bg-tau-bg` so it stays visible while the conversation scrolls.

The Send button is _not_ labeled "Plan" — the old label conflated the
composer's submit with the plan card's Run plan. The composer _sends an
intent_; the plan card _runs the plan_. Two actions, two controls, two
visual treatments.

### 6.4 PlanCard — the review surface (chrome Run plan)

The plan card is where the user decides. It gets visual weight no other
card type gets.

```
┌──────────────────────────────────────────────────────┐
│ PLAN                              low · via mock      │  ← eyebrow + RiskBadge + provider
├──────────────────────────────────────────────────────┤
│ Find files matching *.ts under the current directory │  ← md-lead (sans 13px tau.text)
│                                                      │
│ 01  TOOL  file.find  pattern="*.ts" path="."         │  ← StepRow (mono, numbered rail)
│      keyword matched file lookup                     │     reason in tau.muted sans 12px
│ 02  SHELL $ echo "done"                               │
│      fallback echo                                   │
│                                                      │
│ ▌ caution shell step: review carefully               │  ← issue (warn)
│                                                      │
│ [☐ high risk — run it]                               │  ← only if high risk
│                                                      │
│ ╭──────────────────╮   Discard                       │  ← Run plan = chrome primary,
│ │   Run plan    ▶  │                                  │     Discard = ghost btn
│ ╰──────────────────╯                                  │
└──────────────────────────────────────────────────────┘
```

- **Eyebrow row**: `PLAN` mono uppercase 10px `tau.faint`, `RiskBadge`,
  `via {providerLabel || provider}` mono 11px `tau.faint`.
- **Explanation**: `md-body md-lead` (sans 13px `tau.text` 1.6).
- **Steps**: `<ol>` with left rail `border-l border-tau-line pl-3`,
  each `StepRow` numbered `01`, `02`… (mono 11px `tau.faint`, 20px wide,
  right-aligned).
- **Issues**: `▌ caution` / `▌ blocked` in mono 12px, warn/danger.
- **Plugin warnings**: `▌ plugin {warning}` in mono 12px warn.
- **Deny banner**: `tau.danger/10` bg, `tau.danger/40` border,
  `rounded-6px`, 12px text: "The safety review denied this plan. It
  cannot be executed here."
- **High-risk checkbox**: only shown when `overallRisk === 'high' &&
verdict !== 'deny'`. Label "high risk — run it" in `tau.warn`. The
  checkbox is the _card-local_ `confirmHighRisk` — never a global DOM
  id (preserved contract).
- **Actions**:
  - `Run plan` — chrome primary button, 36px tall, 12px 600 sans, `▶`
    icon. Disabled when `!runnable` (`verdict === 'deny' || running`).
    Running state: pulsing green dot replaces the `▶`, label "Running".
  - `Discard` — ghost button (transparent bg, `tau.line-strong` border,
    `tau.muted` text, danger-hover). Disabled while running.

The chrome sweep on `Run plan` is the _only_ place a non-identity
element gets the gradient. It marks the gate.

### 6.5 StepRow — numbered rail

```html
<li class="flex gap-2.5 py-1.5">
  <span class="step-marker">01</span>
  <!-- mono 11px tau.faint, 20px wide, right-aligned -->
  <div class="min-w-0 flex-1">
    <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span class="kind-tag tool">TOOL</span>
      <!-- or SHELL — see below -->
      <code>file.find</code>
      <!-- tool name, or $ {command} for shell -->
      <code class="args">pattern="*.ts" path="."</code>
      <!-- if any -->
    </div>
    <p class="reason">keyword matched file lookup</p>
    <!-- if present -->
  </div>
</li>
```

Kind tag styles (the only place `tau.info` and `tau.warn` appear as
tints, beyond `RiskBadge` and the provider chip):

- `TOOL`: `tau.info` text, `tau.info/30` border, `tau.info/10` bg.
- `SHELL`: `tau.warn` text, `tau.warn/30` border, `tau.warn/10` bg.

Both 10px mono uppercase, `px-1 rounded-3px border`.

### 6.6 ResultCard — streaming outcome

```
┌──────────────────────────────────────────────────────┐
│ RESULT  find all ts files  ok  2 ok · 1 skipped       │
│        [rendered|raw]  copy  expand                    │
├──────────────────────────────────────────────────────┤
│ file.find in /tmp — 2 match(es)                       │  ← md-body out (max-h 15rem,
│ src/main.ts                                           │     scrollable; expanded removes
│ src/util.ts                                           │     the cap)
└──────────────────────────────────────────────────────┘
```

- Eyebrow: `RESULT` + intent (truncate, title=full) + `RiskBadge(status)`
  - tally (`N ok · N skipped · N failed`) + `streaming…` pulse when
    live.
- Toolbar: segmented `rendered`/`raw` toggle (active = `tau.ok/10` bg,
  `tau.ok` text — the `tau.ok` accent appears here because this is a
  user-controlled view state, not a risk), `copy` (toggles `copied ✓`),
  `expand`/`collapse`.
- Output: `md-body.out` (rendered) or `<pre class="out">` (raw), max-h
  15rem, scrollable; `.expanded` removes the cap.
- Streaming: `tau-pulse` on `streaming…` text. Output grows live; the
  final `result` event overwrites the incremental view (authoritative).

### 6.7 ErrorCard — failed plan request

```
┌──────────────────────────────────────────────────────┐
│ ERROR  find all ts files                              │
│ HTTP 401 from provider: invalid api key               │  ← mono danger
│ configure a key with `tau provider set-key`, or run   │  ← recovery hint
│ offline with `tau config set provider mock`           │
└──────────────────────────────────────────────────────┘
```

Mono danger for the message, sans `tau.faint` for the recovery hint.
Inline code in `tau.raised` bg, `tau.line` border, mono 11px.

### 6.8 EmptyState — the contract, in serif

When the conversation is empty, the chat column shows:

```
                  What can Tau do for you?
                  ─────────────────────────

  Describe what you want in natural language. Tau plans it with the
  active provider, the deterministic safety review runs first, and
  execution only happens after you press Run plan.

  intent → plan → review → you decide → result

  ⌘K focus  ·  ? shortcuts  ·  Alt+N new
```

- Headline: serif 28px (22px on mobile), `tau.text`, centered, tracking
  -0.5px. The serif is the editorial flourish — the _only_ place
  serif appears. It signals "this is a fresh surface" without an
  illustration.
- Body: sans 13px `tau.muted`, centered, max-width 480px.
- Pipeline: mono 12px `tau.faint`, with `you decide` in `tau.ok`.
- Footer: kbd hints in mono 10px `tau.faint`, centered.

### 6.9 SidePanel — reference rail (320px)

Three equal-width tabs (skills / history / tools), sliding indicator
(`tau.ok` 1px, `translateX(tabIndex * 100%)`, no DOM measuring). Arrow
keys navigate (preserved `role=tablist` contract).

- **Skills**: name (mono 12px 600 `tau.text`) + `RiskBadge(risk)` +
  origin (mono 10px `tau.faint`) + description (sans 12px `tau.muted`).
- **History**: `RiskBadge(status, status)` + kind + relTime (title=
  absTime) + truncated input.
- **Tools**: grouped by family prefix (uppercase mono 10px `tau.faint`
  header), each tool = name + `RiskBadge(risk)` + owner (if not
  `core`) + description + param chips (`name[*]type`, `*` =
  required in `tau.warn`).
- Footer: `* required · risk is intrinsic to the tool` mono 10px
  `tau.faint`.
- Lazy loads tools on first Tools-tab visit (preserved contract).

### 6.10 ShortcutsModal — the keyboard contract

Overlay (`fixed inset-0 z-50 bg-black/60`), backdrop click closes.
Panel `tau-panel` `rounded-12px` `max-w-[440px]`. Two-column table:
keycap (mono `tau-kbd`) + action (sans 12.5px `tau.muted`).

| Key           | Action                           |
| ------------- | -------------------------------- |
| Enter         | send the intent                  |
| Shift + Enter | newline in the composer          |
| Ctrl/⌘ + K    | focus the composer               |
| ?             | open this panel (composer empty) |
| Alt + N       | new conversation                 |
| Alt + S       | toggle the reference rail        |
| Esc           | close this panel                 |

Footer: `the safety gate is untouched: nothing runs until you press Run
plan` mono 10px `tau.faint`.

### 6.11 RiskBadge — the ONE semantic atom (unchanged)

```ts
const STYLES: Record<string, string> = {
  ok: "text-tau-ok border-tau-ok/40 bg-tau-ok/10",
  low: "text-tau-ok border-tau-ok/40 bg-tau-ok/10",
  warn: "text-tau-warn border-tau-warn/40 bg-tau-warn/10",
  medium: "text-tau-warn border-tau-warn/40 bg-tau-warn/10",
  danger: "text-tau-danger border-tau-danger/40 bg-tau-danger/10",
  high: "text-tau-danger border-tau-danger/40 bg-tau-danger/10",
  failed: "text-tau-danger border-tau-danger/40 bg-tau-danger/10",
  deny: "text-tau-danger border-tau-danger/40 bg-tau-danger/10",
  blocked: "text-tau-blocked border-tau-line-strong bg-tau-raised",
  cancelled: "text-tau-blocked border-tau-line-strong bg-tau-raised",
};
```

Add a `review` mapping (the running sentinel previously fell through to
`blocked`): `review: text-tau-info border-tau-info/40 bg-tau-info/10`.
This makes the streaming `streaming…` state in ResultCard read as "in
flight" rather than "dead".

## 7. Motion spec

| Interaction                      | Duration           | Easing        | Notes                                  |
| -------------------------------- | ------------------ | ------------- | -------------------------------------- |
| Default (color, border, opacity) | 120ms              | `ease-out`    | buttons, chips, badges                 |
| Layout (sidebar, panel width)    | 200ms              | `ease-out`    | drawer slide, rail toggle              |
| Entrance (cards, modal)          | 180ms              | `--ease`      | `tau-enter` keyframes: fade + 6px rise |
| Tab indicator                    | 180ms              | `--ease`      | `translateX(index * 100%)`             |
| Beam sweep (composer focus)      | 3s linear infinite | —             | conic gradient rotation                |
| Pulse (running / streaming)      | 1.1s               | `ease-in-out` | `tau-pulse` keyframes                  |
| Chrome shimmer (Run plan hover)  | 600ms              | `ease-out`    | `background-position` shift            |

- `prefers-reduced-motion: reduce` disables _all_ of the above (global
  rule in `theme.css` — durations → 0.01ms, the beam becomes a static
  `tau.ok` border).
- Entrances stagger 40ms per card, capped at 200ms.
- No transform-on-hover for buttons (chat.z.ai rule, preserved). Hover
  is color/bg only.
- No bounces, no springs, no parallax. The motion language is "fast and
  quiet."

## 8. Keyboard contract (unchanged)

| Key           | Action                          | Where    |
| ------------- | ------------------------------- | -------- |
| Enter         | send the intent                 | Composer |
| Shift + Enter | newline                         | Composer |
| Ctrl/⌘ + K    | focus composer                  | global   |
| ?             | open shortcuts (composer empty) | global   |
| Alt + N       | new conversation                | global   |
| Alt + S       | toggle reference rail           | global   |
| Esc           | close modal / drawer            | global   |

Adding a shortcut requires updating **three places**: `App.vue`
keydown, `ShortcutsModal.vue` table, `Composer.vue` hint row. Never
intercept browser-reserved chords (Ctrl+T/W/N, Cmd+Q, etc.).

## 9. Backend contract (unchanged, test-pinned)

The HTTP API and NDJSON stream are **byte-for-byte frozen** by the test
suite. This redesign touches **client only**. Specifically unchanged:

- `GET /api/status`, `/api/skills`, `/api/tools`, `/api/history`
- `POST /api/plan`, `/api/execute`, `/api/execute/stream`
- NDJSON event types: `step_start`, `step_output`, `step_end`,
  `plan_end`, `result`, `error`
- 403 as plain JSON (not NDJSON) for deny / high-risk-without-confirm
- `/api/tools` body must never contain the literal `"run"`
- localStorage key `tau-webui-threads-v1`, `MAX_THREADS = 50`,
  `TITLE_CAP = 42`
- `Run plan` button text (screenshot selector)
- `file.find in` output prefix (screenshot selector)

## 10. Avoid-AI-cliché rules (preserved + refined)

1. **No gradients** — except the chrome sweep on the brand mark and the
   `Run plan` primary action. That is the _only_ gradient.
2. **No glassmorphism** — no `backdrop-filter` anywhere.
3. **Shadows** — only the composer's `0 4px 16px rgba(0,0,0,0.18)`.
   Nothing else gets a shadow.
4. **No emoji as UI icons.** Text tags (`TOOL`, `SHELL`, `PLAN`,
   `RESULT`, `ERROR`) in mono are the iconography. `▶` and `✕` are
   geometric glyphs, not emoji.
5. **Data in mono, prose in sans.** Never the reverse.
6. **Restraint over decoration.** If an element doesn't carry
   information, delete it.
7. **Copy is concrete and English.** "high risk — run it", "nothing
   runs before Run plan", "the safety review denied this plan".

## 11. File ownership map

| File                                   | Owns                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------ |
| `uno.config.ts`                        | color tokens, font-family tokens, shortcuts (the util-generating layer)              |
| `client/theme.css`                     | base layer: body, fonts vars, motion vars, scrollbar, kbd, markdown prose, keyframes |
| `client/App.vue`                       | shell: header + 3-col grid + drawer + modal + global keymap + autoscroll             |
| `client/components/StatusHeader.vue`   | top bar                                                                              |
| `client/components/SessionSidebar.vue` | history rail                                                                         |
| `client/components/Composer.vue`       | the beam + toolbar + send                                                            |
| `client/components/PlanCard.vue`       | review surface + chrome Run plan                                                     |
| `client/components/StepRow.vue`        | numbered step rail                                                                   |
| `client/components/ResultCard.vue`     | streaming outcome                                                                    |
| `client/components/ErrorCard.vue`      | failed plan                                                                          |
| `client/components/EmptyState.vue`     | serif hero + contract                                                                |
| `client/components/SidePanel.vue`      | skills/history/tools rail                                                            |
| `client/components/ShortcutsModal.vue` | keyboard contract overlay                                                            |
| `client/components/RiskBadge.vue`      | the ONE semantic atom                                                                |
| `client/composables/session.ts`        | status/skills/tools/history (module singleton)                                       |
| `client/composables/plan-flow.ts`      | threads + cards state machine (localStorage-persisted)                               |
| `client/lib/api.ts`                    | typed HTTP client (no `@tau/*` runtime import)                                       |
| `client/lib/stream.ts`                 | DOM-free NDJSON splitter (unit-tested)                                               |
| `client/lib/format.ts`                 | args/time/tool-family formatters                                                     |
| `client/lib/highlight.ts`              | shiki progressive upgrade (silent no-op)                                             |
| `DESIGN.md` (this file)                | the spec                                                                             |
| `SKILL.md`                             | the checklist (contract layer)                                                       |

## 12. Verification checklist

Before claiming the redesign done:

- [ ] `pnpm --filter @tau/webui build` clean (zero unmatched-utility
      warnings, zero type errors)
- [ ] `pnpm test` green — all 4 webui test files (server, server-stream,
      stream, e2e.snapshot) pass byte-for-byte
- [ ] `pnpm --filter @tau/webui shots` regenerates both PNGs
- [ ] Three breakpoints render correctly: ≥1024 (3-col), 640–1023
      (drawer + below), <640 (single flow)
- [ ] `prefers-reduced-motion: reduce` respected (beam static, no
      pulse, no entrance animation)
- [ ] Chrome sweep appears only on (a) the `τ` brand mark and (b) the
      `Run plan` primary action — nowhere else
- [ ] `Run plan` button text and `file.find in` output prefix unchanged
      (screenshot selectors)
- [ ] localStorage key `tau-webui-threads-v1` unchanged (no migration)
- [ ] This file + `SKILL.md` updated together if tokens change

---

_Pixel reference: chat.z.ai (captured 2026-09-02, logged-out landing
surface). Conversation/message-bubble anatomy inferred from tokens +
GLM/Z.ai conventions; the active-conversation view was not captured
read-only._
