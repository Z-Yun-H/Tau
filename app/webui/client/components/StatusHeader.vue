<script setup lang="ts">
/**
 * StatusHeader — identity + runtime facts, one slim row (48px). Fused
 * with the app bg (no panel bg), separated from the body by a gradient
 * divider (not a bare hairline). The `τ` brand mark carries the chrome
 * sweep — the only place identity gets the ornamental gradient.
 *
 * The theme button (right end) cycles system → light → dark (Alt+T);
 * state lives in lib/theme.ts, persisted in `tau-webui-theme-v1`.
 *
 * Wraps on narrow screens: tauHome hides first (<640px), then the
 * skills/plugins count chip (<768px).
 */
import { useSession } from "../composables/session.js";
import { useTheme } from "../lib/theme.js";

const { status, statusError } = useSession();
const { preference, resolved } = useTheme();

const themeTitle = "theme: system → light → dark (Alt+T)";
const themeGlyph = (): string => (resolved.value === "light" ? "☀" : "☾");
const themePrefLabel = (): string => (preference.value === "system" ? "auto" : preference.value);
</script>

<template>
  <header class="flex flex-wrap items-center gap-x-2.5 gap-y-1 h-12 px-4 bg-tau-bg flex-none">
    <span class="brand-mark font-mono text-[18px] whitespace-nowrap select-none">
      <span class="brand-chrome">τ</span>
      <b class="text-tau-text font-medium ml-0.5">tau web</b>
    </span>

    <span v-if="status" class="tau-chip" title="active AI provider">
      <span class="text-tau-info">{{ status.provider.name }}</span>
      <span class="text-tau-faint">·</span>
      <span class="text-tau-faint">{{ status.provider.model }}</span>
    </span>
    <span v-else-if="statusError" class="tau-chip text-tau-danger" :title="statusError">
      status unavailable
    </span>
    <span v-else class="tau-chip">…</span>

    <span
      v-if="status"
      class="tau-chip hidden md:inline-flex"
      title="loaded skills · configured MCP plugins"
    >
      <span>skills {{ status.skills }}</span>
      <span class="text-tau-faint">·</span>
      <span>plugins {{ status.plugins }}</span>
    </span>

    <span class="flex-1" />

    <span v-if="status" class="tau-chip" title="tau version">v{{ status.version }}</span>
    <span v-if="status" class="tau-chip hidden sm:inline-flex max-w-40" :title="status.tauHome">
      <span class="truncate">{{ status.tauHome }}</span>
    </span>
    <button
      type="button"
      class="theme-btn"
      :title="themeTitle"
      :aria-label="`theme: ${themePrefLabel()} — click to cycle`"
      @click="cyclePreference()"
    >
      <span class="theme-glyph">{{ themeGlyph() }}</span>
      <span class="theme-pref">{{ themePrefLabel() }}</span>
    </button>
  </header>
</template>

<style scoped>
/* Gradient divider under the header — a fading edge, not a bare 1px
   hairline (DESIGN.md §3 "no bare hairlines"). */
header::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: -1px;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--tau-line-strong), transparent);
  pointer-events: none;
}
header {
  position: relative;
}

.brand-mark {
  letter-spacing: -0.01em;
  display: inline-flex;
  align-items: baseline;
}

/* The `τ` brand mark — a metallic silver character. The full chrome sweep
   is reserved for the Run plan button (where the larger surface shows the
   dark→bright→dark transit clearly); the small τ uses a bright metallic
   fill with a subtle vertical sheen so it reads as identity, not flat
   text. The drop-shadow gives it a touch of depth on the dark header. */
.brand-chrome {
  display: inline-block;
  font-weight: 700;
  font-size: 20px;
  line-height: 1;
  background-image: linear-gradient(
    180deg,
    var(--tau-chrome-5) 0%,
    var(--tau-chrome-5) 50%,
    var(--tau-chrome-4) 100%
  );
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
  transition: filter var(--t-fast) var(--ease);
}

.brand-mark:hover .brand-chrome {
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5)) drop-shadow(0 0 6px rgba(168, 170, 184, 0.4));
}

/* Theme cycle button — quiet ghost control, matches tau-chip height. */
.theme-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--tau-line-strong);
  border-radius: 6px;
  background: var(--tau-raised);
  color: var(--tau-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.4;
  padding: 3px 7px;
  cursor: pointer;
  transition:
    color var(--t-fast) var(--ease),
    border-color var(--t-fast) var(--ease),
    box-shadow var(--t-fast) var(--ease);
  box-shadow: var(--tau-elev-1);
}
.theme-btn:hover {
  color: var(--tau-text);
  border-color: var(--tau-faint);
}
.theme-glyph {
  font-size: 12px;
}
.theme-pref {
  letter-spacing: 0.02em;
}
</style>
