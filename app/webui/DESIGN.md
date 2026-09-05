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
   the primary action. Hierarchy comes from typography and **layered
   surfaces** — soft elevation shadows and gradient edges, never a bare
   1px hairline drawn on a flat fill (§3, §6).
2. **Plans are first-class.** A plan is not a chat message — it is a
   contract the user must review. Plan cards get visual weight (left
   rail, numbered steps, verdict badge, Run plan as the chrome primary
   action) that user bubbles and result cards do not.
3. **The gate is visible.** "Nothing runs before Run plan" is the
   product's promise. Every screen makes the gate legible: empty state,
   plan card, shortcuts modal, result card — all reference the same
   control.

## 2. Token sources of truth

| Token kind             | Lives in                           | Notes                                                                                  |
| ---------------------- | ---------------------------------- | -------------------------------------------------------------------------------------- |
| Colors (both themes)   | `client/theme.css` CSS vars        | `--tau-*` on `:root` (dark default) + `html[data-theme="light"]` — THE single source   |
| Color → utility map    | `uno.config.ts` `theme.colors.tau` | every `tau.*` maps to `var(--tau-*)`; class names are theme-independent, never raw hex |
| Fonts + motion         | `client/theme.css` CSS vars        | `--font-sans`, `--font-mono`, `--font-serif`, `--t-*`, `--ease`                        |
| Elevation              | `client/theme.css` CSS vars        | `--tau-elev-1/2/3` shadows + `--tau-edge-gradient` + `--tau-backdrop`, tuned per theme |
| Theme state            | `client/lib/theme.ts`              | three-state preference, `tau-webui-theme-v1` key, boot script twin in `index.html`     |
| Spacing / radii / type | inline Uno utilities               | 4px grid; radii 4/6/8/12px; sizes 10–60px                                              |

## 3. Color system — two themes, fused, layered

Two full ramps ship: **dark** (the rendering baseline — CSS default on
`:root`, pinned by tests + the product's terminal lineage) and **light**
(activated by `html[data-theme="light"]`). Both are tuned to the same
structure so components never know which theme is active.

### Theme switching contract

- Preference is three-state: `'light' | 'dark' | 'system'`, persisted in
  the `tau-webui-theme-v1` localStorage key (**pure addition** — the
  pinned `tau-webui-threads-v1` key is untouched). `'system'` stores
  nothing (absence = system) and live-follows `prefers-color-scheme`.
- A boot script in `index.html` resolves the preference **before first
  paint** (no wrong-theme flash). Dark needs no attribute; only light
  adds `data-theme="light"`.
- The `StatusHeader` button cycles `system → light → dark` (`Alt+T`);
  state lives in `client/lib/theme.ts` (`useTheme()` singleton).
- Screenshots pin `colorScheme` per pass (`scripts/screenshot.mjs`) —
  headless Chromium defaults to light and would flip the dark baseline.

### Neutral ramps — page → panel → raised → active

Dark (baseline, `:root`):

| Token             | Hex       | Role                                                        |
| ----------------- | --------- | ----------------------------------------------------------- |
| `tau.bg`          | `#0B0E13` | page background — the canvas                                |
| `tau.panel`       | `#0E1219` | sidebar / cards / composer shell — layered above the canvas |
| `tau.raised`      | `#141A24` | hover surface, dropdowns, raised controls                   |
| `tau.active`      | `#1B2331` | active thread, pressed state, focus-within tint             |
| `tau.line`        | `#1B2230` | input/control inner lines (small controls only)             |
| `tau.line-strong` | `#28303F` | control borders, focus-adjacent borders                     |
| `tau.text`        | `#E6EBF2` | primary text                                                |
| `tau.muted`       | `#9AA5B4` | secondary prose, descriptions                               |
| `tau.faint`       | `#5C6776` | meta (timestamps, kbd hints, placeholder)                   |
| `tau.placeholder` | `#3F4856` | textarea placeholder (deliberately dimmer than `faint`)     |

Light (`html[data-theme="light"]`) — same structure, tuned for AA on a
bright canvas:

| Token             | Hex       | Role                                  |
| ----------------- | --------- | ------------------------------------- |
| `tau.bg`          | `#EEF1F6` | page background                       |
| `tau.panel`       | `#F7F9FC` | panels / cards — read as raised paper |
| `tau.raised`      | `#FFFFFF` | hover surface, raised controls        |
| `tau.active`      | `#E6ECF4` | active thread, pressed state          |
| `tau.line`        | `#D9E0EA` | input/control inner lines             |
| `tau.line-strong` | `#BCC7D5` | control borders                       |
| `tau.text`        | `#1A2230` | primary text                          |
| `tau.muted`       | `#5A6575` | secondary prose                       |
| `tau.faint`       | `#8A94A4` | meta                                  |
| `tau.placeholder` | `#A8B1BF` | textarea placeholder                  |

### Surfaces are LAYERED, not line-drawn

A bare 1px hairline on a flat background is a **design bug** in both
themes. Every major surface (cards, sidebar dock, composer shell,
modal) carries the `.tau-surface` treatment from `theme.css`; surfaces
that must sit higher apply the elevation tokens directly:

- **Elevation shadows** — `--tau-elev-1` (resting card), `--tau-elev-2`
  (composer), `--tau-elev-3` (focused composer, modal). Soft, wide,
  theme-tuned: dark shadows deepen, light shadows tint (`rgba(16,24,40,…)`)
  plus a white rim so panels read on the bright canvas.
- **Gradient edge** — `--tau-edge-gradient` paints the 1px border box
  via the padding-box/border-box trick: a top-lit fading edge instead
  of a flat line.
- **Gradient dividers** — `.tau-divider` (an `<hr>`) or an `::after`
  fade replaces section separators (header bottom, tab-nav track,
  sidebar head/footer). `tau.line`/`tau.line-strong` remain for small
  controls (inputs, buttons, kbd, chips) — controls, not separators.

### Semantic system — risk (two-step, per-theme tuned)

| Level                      | Token         | Dark `#`  | Light `#` | Meaning                         |
| -------------------------- | ------------- | --------- | --------- | ------------------------------- |
| `low` / `ok`               | `tau.ok`      | `#5EC97A` | `#1E7A46` | safe, success, the brand accent |
| `medium` / `warn`          | `tau.warn`    | `#E0A53C` | `#93641A` | caution, plugin tools           |
| `high` / `failed` / `deny` | `tau.danger`  | `#E5534B` | `#C0342E` | blocked, failed, denied         |
| `blocked` / `cancelled`    | `tau.blocked` | `#6E7887` | `#5F6A7A` | dim gray                        |

Each semantic color exposes a **two-step system** so themes tune tint
and border independently (var()-based colors cannot use the
`/opacity` utility syntax):

- `tau.<name>-soft` — surface tint (~8–11% alpha), e.g. badge fills;
- `tau.<name>-edge` — control border (~42–45% alpha), e.g. badge rings,
  primary-button borders, focus-adjacent edges.

Light-theme hues are darker and less saturated than their dark siblings
(same family) to hold AA contrast on the bright canvas.

Risk colors flow **only** through `RiskBadge.vue`. Never use `tau.ok` on
a large fill — it doubles as the brand accent (primary buttons, focus
ring, tab indicator) and must stay scarce.

### Accent — chrome (ornamental, self-colored)

| Token                           | Hex                               | Role                                           |
| ------------------------------- | --------------------------------- | ---------------------------------------------- |
| `tau.chrome-1` … `tau.chrome-9` | `#191A1D` → `#A8AAB8` → `#191A1D` | 9-stop sweep for chrome surfaces (both themes) |
| `--tau-on-chrome`               | `#F0F2F7` (constant)              | text/icons ON a chrome fill                    |

A single metallic gradient — **self-colored**: identical in both
themes, like a physical chrome bezel. Three places, three treatments:

1. **The `τ` brand mark** in the header — a vertical metallic sheen via
   `background-clip:text` (chrome-5 → chrome-4), with a drop-shadow for
   depth. The full sweep does not read on a single narrow glyph, so the
   brand uses a bright vertical gradient + glow on hover instead.
2. **The `Run plan` button** on the PlanCard (and its sibling
   `+ new conversation` in the sidebar) — the full 9-stop horizontal
   chrome sweep as a button FILL. Anything sitting on the fill uses
   `--tau-on-chrome`, never `tau.text` (which flips dark in the light
   theme and would vanish on the dark metal).
3. **The composer focus beam** — the rotating conic border sweeps
   chrome-5 between ok/info stops (§6.3).

Never on data surfaces, never on hover states (except the brand glow
and the sweep's own `background-position` shimmer). The chrome sweep
and the structural edge gradients (§ above) are the ONLY gradients;
everything else is matte.

### Provider identity

| Token      | Dark `#`  | Light `#` | Role                                |
| ---------- | --------- | --------- | ----------------------------------- |
| `tau.info` | `#6BB3D9` | `#22629E` | provider name chip, `tool` step tag |

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
- SidePanel moves below the chat, `max-h-[45vh]` (scrolling
  internally).
- The page shell stays viewport-locked: the conversation stream is the
  one scrolling column and the composer is its last flex child, so it
  stays visible (`bg-tau-bg` over the stream edge) without page-level
  scrolling.

### <640px (`sm:` and below) — single column, still viewport-locked

- Same viewport-locked narrow layout as 640–1023px (stream scrolls,
  composer visible, rail below) — single column, no grid.
- Sidebar drawer stays (now full-width 280px).
- StatusHeader drops the `tauHome` chip and the skills/plugins count
  chip; only brand + provider + version remain.
- Composer fills width with 12px side gutters; textarea min-height
  drops to 44px.
- SidePanel goes full-width below the chat.
- Empty-state hero serif headline shrinks 28px → 22px.

## 6. Component anatomy

### 6.1 StatusHeader — slim top bar (48px)

A single row, `h-12`, fused with the app bg, closed by a **gradient
divider** (`header::after` — a fading edge, not a bare hairline). Four
zones:

```
[ τ tau ]      [provider chip ▾] [skills·plugins]        [v0.2.0] [~/.tau] [☾ auto]
   ↑                ↑                ↑                        ↑        ↑         ↑
 chrome brand  info accent       meta (md+)              meta     meta (sm+)  theme btn
```

- Brand: `τ` in a metallic fill (`brand-chrome`, background-clip with a
  vertical sheen), `tau` in `tau.text` 18px
  mono 500. Hovering the brand does nothing — it is identity, not a
  control.
- Provider chip: `tau-chip` with provider name in `tau.info` and model
  in `tau.faint`, separated by a thin dot. Title attribute shows the
  availability source.
- Skills·plugins chip (hidden <640px): mono count.
- Version chip: mono, `tau.faint`.
- tauHome chip (hidden <640px): mono, truncated, `tau.faint`.
- **Theme button** (right end): a quiet ghost control (`tau.raised` bg,
  `elev-1`, chrome-free) showing the resolved glyph (`☀`/`☾`) + the
  preference label (`auto`/`light`/`dark`). Click cycles
  `system → light → dark`; `Alt+T` is the keyboard twin (§8). State
  lives in `client/lib/theme.ts` — the button is a pure view of it.

### 6.2 SessionSidebar — layered history rail (260px)

The dock is a `.tau-surface` panel (gradient edge + `elev-1`; rounded
on lg+, full-bleed in the mobile drawer). Section separators inside it
are `.tau-divider` gradient `<hr>`s — no bare lines.

```
╔════════════════════════════════╗
║ + new conversation      (chrome║  ← primary action, full width
╟────────────────────────────────╢  ← tau-divider
║ find all ts files under sr…    ║  ← active thread (tau.active bg,
║ 3 cards · 5m ago            ✕  ║     tau.line-strong border)
║                                ║
║ ping example.com               ║  ← thread row (hover: tau.raised)
║ 1 card · 1h ago             ✕  ║
║                                ║
║ …                              ║
╟────────────────────────────────╢  ← tau-divider
║ Alt+N new · Ctrl+K focus       ║  ← footer hints
╚════════════════════════════════╝
```

- Header: `+ new conversation` chrome-primary button, full width, 36px
  tall; its label uses `--tau-on-chrome` (constant light — see §3).
  Replaces the old `+ new` corner button.
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
single rounded panel (`rounded-12px`, `tau.panel` interior) wrapped in
the **beam** — a 1.5px gradient frame that carries `--tau-elev-2` at
rest (the elevation is deliberately visible unfocused, so the composer
anchors the stream) and upgrades to `--tau-elev-3` + the rotating conic
beam on focus.

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
  frame's background becomes a 1.5px conic-gradient rotating border (the
  `--beam-angle` `@property` trick from chat.z.ai; browsers without
  `@property` get a static conic gradient — same hues, no rotation).
  The beam sweeps chrome between ok/info stops so it reads as "this is
  alive" without being loud. At rest the frame is a faint vertical
  gradient (`tau.faint → tau.line-strong`).
- **Textarea**: borderless, transparent bg, 14px sans, min-h 44px,
  max-h 160px, auto-grow. Enter sends, Shift+Enter newlines,
  `isComposing` respected (IME).
- **Toolbar** (`h-10`, closed by a `tau-divider` gradient `<hr>`):
  - Left: kbd hints (`⌘K focus` · `? shortcuts`) in mono 10px
    `tau.faint`, dotted-underlined when clickable.
  - Right: the **Send button** — a 28×28 square, `rounded-8px`. Disabled
    state: `tau.raised` bg, `tau.faint` text. Enabled state: chrome
    sweep bg, dark `▶` icon. Hover: brighten the sweep
    (`background-position` shift).
- **Always visible on narrow screens**: the composer is the last flex
  child of the viewport-locked stream column (`bg-tau-bg` over the
  stream edge), so it never scrolls away — no sticky positioning
  needed.

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
    icon; label and icon use `--tau-on-chrome` (§3 — constant light on
    the self-colored sweep, readable in BOTH themes). Disabled when
    `!runnable` (`verdict === 'deny' || running`). Running state:
    pulsing green dot replaces the `▶`, label "Running".
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
- **Tools** (main-info-first layout):
  - **Catalog overview row** at the top: `N tools · N read · N mutates · N dry-run`
    in a `tau.raised` pill (`rounded-6px`), counts color-coded (`tau.ok` for
    read, `tau.warn` for mutates, `tau.info` for dry-run). The user sees the
    catalog shape at a glance.
  - **Family groups** with count headers: `FILE (6)`, `SYS (6)`, `NET (4)`,
    `TEXT (4)` — uppercase mono 10px `tau.faint`, count in `tau.placeholder`.
  - **Each tool**: name (mono 12px 600 `tau.text`) + `RiskBadge(risk)` +
    kind tag (`READ` info-tinted / `MUT` warn-tinted, matching the StepRow
    kind-tag visual language) + optional `DRY` tag (`tau.faint`) for
    dry-run-default tools + owner (if not `core`) + description + param
    chips (`name[*]type`, `*` = required in `tau.warn`).
  - Footer: `* required · risk is intrinsic to the tool · MUT mutates · DRY
dry-run default` mono 10px `tau.faint`.
- Lazy loads tools on first Tools-tab visit (preserved contract).

### 6.10 ShortcutsModal — the keyboard contract

Overlay (`fixed inset-0 z-50`, scrim `var(--tau-backdrop)` — theme
tuned), backdrop click closes. Panel `tau-panel` (→ `.tau-surface`,
`rounded-12px`, `max-w-[440px]`, floating `elev-3` treatment),
`tau-enter` fade + rise. Two-column table:
keycap (mono `tau-kbd`) + action (sans 12.5px `tau.muted`).

| Key           | Action                            |
| ------------- | --------------------------------- |
| Enter         | send the intent                   |
| Shift + Enter | newline in the composer           |
| Ctrl/⌘ + K    | focus the composer                |
| ?             | open this panel (composer empty)  |
| Alt + N       | new conversation                  |
| Alt + S       | toggle the reference rail         |
| Alt + T       | cycle theme system → light → dark |
| Esc           | close this panel                  |

Footer: `the safety gate is untouched: nothing runs until you press Run
plan` mono 10px `tau.faint`.

### 6.11 RiskBadge — the ONE semantic atom (two-step tokens)

```ts
const STYLES: Record<string, string> = {
  ok: "text-tau-ok border-tau-ok-edge bg-tau-ok-soft",
  low: "text-tau-ok border-tau-ok-edge bg-tau-ok-soft",
  warn: "text-tau-warn border-tau-warn-edge bg-tau-warn-soft",
  medium: "text-tau-warn border-tau-warn-edge bg-tau-warn-soft",
  danger: "text-tau-danger border-tau-danger-edge bg-tau-danger-soft",
  high: "text-tau-danger border-tau-danger-edge bg-tau-danger-soft",
  failed: "text-tau-danger border-tau-danger-edge bg-tau-danger-soft",
  deny: "text-tau-danger border-tau-danger-edge bg-tau-danger-soft",
  review: "text-tau-info border-tau-info-edge bg-tau-info-soft",
  blocked: "text-tau-blocked border-tau-line-strong bg-tau-raised",
  cancelled: "text-tau-blocked border-tau-line-strong bg-tau-raised",
};
```

The `-soft`/`-edge` two-step tokens (§3) replace ad-hoc `/opacity`
modifiers — var()-based utility colors cannot use the slash syntax, and
per-theme tuning of tint vs border belongs to the token layer. The
`review` mapping (info blue) keeps the streaming `streaming…` state in
ResultCard reading as "in flight" rather than "dead".

### 6.12 SettingsPanel — settings with narrow writable slices

One floating modal (`Ctrl/⌘+,`, or the `⚙ settings` button at the
header's right end; `Esc`/backdrop closes), reusing the ShortcutsModal
skeleton: `.tau-surface rounded-12px` panel at `max-w-520px`, scrim
`var(--tau-backdrop)`, `tau-enter` fade + rise. Five sections, separated
by gradient dividers (the layout primitives live in `theme.css` so the
ProviderSetup child shares them):

```
SETTINGS  [provider setup · rest read-only]              [esc]
────────────────────────────────────────────────────────────
PROVIDER      chips: openai✓ ·key | anthropic✕ | ollama✓ …
              endpoint  https://api.deepseek.com  ← LOOKED UP
              (advanced — custom endpoint disclosure)
              saved     sk-***1234          ← server mask only
              api key   [············] (show)  ← password, re-masks 8s
              [x] make deepseek the active provider    [save]
PROVIDER      active    Mock (offline demo) via config
              model     [mock-reasoner ▾] [⟳]   ← catalog-backed select
              availability chips · catalog N cached · refreshed <relTime>
              thinking  [ on | off ] [ low | medium | high ]
              ← capability-driven; knob-less providers: honest note
RISK POLICY   allowMediumAutoApprove / timeout / shell / aliases
              "read-only — change with tau config set <key> <value>"
APPEARANCE    [ system | light | dark ]  ← one state, three views
SESSIONS      threads N/50 · history N loaded · tau home
────────────────────────────────────────────────────────────
provider keys stay masked (sk-***last4) — provider setup is the only
writable section; the gate never moves into the browser
```

- **Data source**: a single `GET /api/config` fetched on mount — the
  redacted effective config (the same `redactConfig` `tau config list`
  prints), live provider availability, the server-sent provider catalog
  (endpoints + console links, registry-parity-checked), and the active
  provider's model-catalog cache state. Loading and error states are
  honest (`loading config…` pulse / `config unavailable — <reason>`).
- **Write paths, deliberately narrow (issues #152/#164)**: provider
  credentials (`provider` / `apiKey` / `baseUrl` / `activate`) via
  `POST /api/config/provider` — the same `setConfigValue` channel
  `tau provider set-key` uses — plus the model choice (`POST
/api/config/model`) and thinking mode/effort (`POST
/api/config/thinking`, issue #164): per-provider REQUEST knobs, all
  validated before mutation. Plaintext keys are never echoed back, never
  logged; the saved state renders the server's mask only. The gate and
  risk policy stay read-only in the browser; the footer says so.
- **Capability-driven thinking controls (issue #164)**: the mode and
  effort mini-pickers render straight from the payload's capability
  table — providers without a knob render the honest
  "provider default — <name> exposes no thinking knobs" note instead of
  dead controls.
- **防窥 masking**: the key input is a `password` field; the `show`
  toggle reveals it for 8 seconds and re-masks itself (no lingering
  plaintext for shoulder-surfers); the input clears on save.
- **Appearance picker**: a three-option segmented control (`role=radiogroup`)
  bound to the SAME `useTheme()` singleton as the header button —
  `system` active state carries the `tau.ok` accent; both views stay in
  sync by construction.
- **Availability chips**: `name ✓` in ok-soft when the provider answers,
  `name ✕` in faint when not — per-machine truth, not aspiration.

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

## 8. Keyboard contract

| Key           | Action                            | Where    |
| ------------- | --------------------------------- | -------- |
| Enter         | send the intent                   | Composer |
| Shift + Enter | newline                           | Composer |
| Ctrl/⌘ + K    | focus composer                    | global   |
| ?             | open shortcuts (composer empty)   | global   |
| Alt + N       | new conversation                  | global   |
| Alt + S       | toggle reference rail             | global   |
| Alt + T       | cycle theme system → light → dark | global   |
| Ctrl/⌘ + ,    | open settings (read-only)         | global   |
| Esc           | close modal / drawer              | global   |

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

Additive in v0.4.0 (issue #97) — new surface, zero edits to the frozen
shapes above:

- `POST /api/goal/stream` — agent mode over `runGoal()`. Emits
  `goal_registered` (goalId), then runGoal's lifecycle verbatim
  (`goal_start`, `round_plan`, `round_end`, `approval_required`,
  `goal_end`) interleaved with the EXISTING step_* event shapes, and a
  terminal `goal_result`. Non-"allow" rounds (ANY round, first included)
  pause the stream until `POST /api/goal/approve {goalId, approve}` or
  the 10-minute TTL (`TAU_WEBUI_APPROVAL_TTL_MS` overrides; timeout →
  `approval_timeout` + goal cancelled). Client disconnect aborts the
  goal runGoal-side (process-group kill mid-shell included).
- Agent mode is NEVER a blanket pre-approval: every medium+ round — the
  first one too — shows the plan and waits for a per-round decision.

## 10. Avoid-AI-cliché rules (preserved + refined)

1. **No decorative gradients** — the chrome sweep (brand mark, chrome
   buttons) and the STRUCTURAL edge/divider gradients (`--tau-edge-gradient`,
   `.tau-divider`) are the only ones. No gradient text, no gradient
   fills on data surfaces.
2. **No glassmorphism** — no `backdrop-filter` anywhere.
3. **Shadows only via elevation tokens** — `--tau-elev-1/2/3`. No
   ad-hoc `box-shadow` values; if a surface needs depth, it gets a
   token level (and the light-theme twin comes for free).
4. **No emoji as UI icons.** Text tags (`TOOL`, `SHELL`, `PLAN`,
   `RESULT`, `ERROR`) in mono are the iconography. `▶`, `✕`, `☀`, `☾`
   are geometric/astronomical glyphs, not emoji.
5. **Data in mono, prose in sans.** Never the reverse.
6. **Restraint over decoration.** If an element doesn't carry
   information, delete it.
7. **Copy is concrete and English.** "high risk — run it", "nothing
   runs before Run plan", "the safety review denied this plan".
8. **Both themes or nothing.** Any new color goes through a CSS var
   with BOTH a dark and a light value; any new surface gets the
   layered treatment, never a bare hairline. Verify against
   `docs/screenshots/plan.png` (dark) and `plan-light.png` (light).

## 11. File ownership map

| File                                             | Owns                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `client/theme.css`                               | `--tau-*` color vars for BOTH themes, elevation/edge vars, surface classes, dividers, base layer |
| `uno.config.ts`                                  | `tau.*` → `var(--tau-*)` mapping + font/utility shortcuts (no raw hex)                           |
| `client/App.vue`                                 | shell: header + 3-col grid + drawer + modal + global keymap (incl. Alt+T) + autoscroll           |
| `client/components/StatusHeader.vue`             | top bar + theme cycle button                                                                     |
| `client/components/SessionSidebar.vue`           | history rail (`.tau-surface` dock)                                                               |
| `client/components/Composer.vue`                 | the beam + toolbar + send                                                                        |
| `client/components/PlanCard.vue`                 | review surface + chrome Run plan (`--tau-on-chrome` label)                                       |
| `client/components/GoalCard.vue`                 | agent-mode round timeline (live steps, per-round approval bar, Stop)                             |
| `client/components/StepRow.vue`                  | numbered step rail                                                                               |
| `client/components/ResultCard.vue`               | streaming outcome                                                                                |
| `client/components/ErrorCard.vue`                | failed plan                                                                                      |
| `client/components/EmptyState.vue`               | serif hero + contract                                                                            |
| `client/components/SidePanel.vue`                | skills/history/tools rail                                                                        |
| `client/components/ShortcutsModal.vue`           | keyboard contract overlay                                                                        |
| `client/components/SettingsPanel.vue`            | read-only settings surface (`GET /api/config` view + theme picker)                               |
| `client/components/RiskBadge.vue`                | the ONE semantic atom                                                                            |
| `client/composables/session.ts`                  | status/skills/tools/history (module singleton)                                                   |
| `client/composables/plan-flow.ts`                | threads + cards state machine (localStorage-persisted; goal cards + abort-controller registry)   |
| `client/lib/api.ts`                              | typed HTTP client (no `@tau/*` runtime import)                                                   |
| `client/lib/stream.ts`                           | DOM-free NDJSON splitter (unit-tested)                                                           |
| `client/lib/format.ts`                           | args/time/tool-family formatters                                                                 |
| `client/lib/highlight.ts`                        | shiki progressive upgrade (silent no-op)                                                         |
| `client/lib/slash.ts` (v0.6.0)                   | composer command-menu pure logic (filter/clamp/open rules over the shared catalog)               |
| `client/lib/attachments.ts` (v0.6.0)             | image-attachment drafts: caps, chunked base64, all-or-nothing batches, payload/meta projections  |
| `client/lib/preview.ts` (v0.6.0)                 | sandboxed html-preview srcdoc builder + DOM attach pass + binary view sniffing (server parity)   |
| `client/components/AttachmentChips.vue` (v0.6.0) | image chips (preview thumb, session-only; persisted meta strips thumbs)                          |
| `client/lib/theme.ts`                            | three-state theme preference, `tau-webui-theme-v1` persistence, `useTheme()` singleton           |
| `scripts/screenshot.mjs`                         | real-server screenshot rig (dark pinned + light pass + agent pass, 5 PNGs)                       |
| `src/server.ts`                                  | HTTP API incl. `/api/goal/stream` + `/api/goal/approve` (additive, v0.4.0)                       |
| `src/goal.ts`                                    | goal approval registry (TTL, one pending decision per goal)                                      |
| `DESIGN.md` (this file)                          | the spec                                                                                         |
| `SKILL.md`                                       | the checklist (contract layer)                                                                   |

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
