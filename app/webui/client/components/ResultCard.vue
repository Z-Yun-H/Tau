<script setup lang="ts">
/**
 * ResultCard — the execution outcome. Status badge + an honest per-step
 * tally before the output. Preview controls: rendered/raw toggle (markdown
 * preview vs the exact bytes), one-click copy, and expand for long output.
 * The raw view is always one click away — the preview never hides what the
 * steps actually printed.
 *
 * The `streaming…` pulse uses tau-pulse (single definition, in theme.css).
 */
import { computed, nextTick, ref, watch } from "vue";
import { useClipboard } from "@vueuse/core";
import { renderMarkdown } from "@tau/markdown";
import type { ResultCardState } from "../composables/plan-flow.js";
import { highlightPreBlocks } from "../lib/highlight.js";
import RiskBadge from "./RiskBadge.vue";

const props = defineProps<{ card: ResultCardState; enterIndex?: number }>();

const enterDelay = computed(() => `${Math.min((props.enterIndex ?? 0) * 40, 200)}ms`);

const view = ref<"rendered" | "raw">("rendered");
const expanded = ref(false);
const rootEl = ref<HTMLElement | null>(null);

const html = computed(() => renderMarkdown(props.card.output));

// vueuse useClipboard — copied auto-resets; silent on permission errors.
const { copy: copyText, copied, isSupported } = useClipboard({ legacy: true });

async function copy(): Promise<void> {
  if (!isSupported.value) return;
  try {
    await copyText(props.card.output);
  } catch {
    // clipboard unavailable — no-op
  }
}

// Progressive shiki highlighting: plain escaped markdown first, upgraded
// in place after each render (streaming updates re-trigger this watch).
watch(
  [html, view],
  () => {
    void nextTick(() => {
      if (rootEl.value && view.value === "rendered") void highlightPreBlocks(rootEl.value);
    });
  },
  { immediate: true },
);

const tally = computed(() => {
  const oks = props.card.outcomes.filter((o) => o.ok && !o.skipped).length;
  const skipped = props.card.outcomes.filter((o) => o.skipped).length;
  const failed = props.card.outcomes.length - oks - skipped;
  const parts: string[] = [];
  if (oks) parts.push(`${oks} ok`);
  if (skipped) parts.push(`${skipped} skipped`);
  if (failed) parts.push(`${failed} failed`);
  return parts.join(" · ");
});

const statusLevel = computed(() =>
  props.card.status === "running"
    ? "review"
    : props.card.status === "ok"
      ? "ok"
      : props.card.status === "denied"
        ? "blocked"
        : "danger",
);
</script>

<template>
  <article ref="rootEl" class="tau-card tau-surface result-enter">
    <div class="card-eyebrow">
      <span class="eyebrow-label">result</span>
      <span class="intent-text" :title="card.intent">{{ card.intent }}</span>
      <RiskBadge :level="statusLevel" :label="card.status" />
      <span v-if="tally" class="tally">{{ tally }}</span>
      <span v-if="card.streaming" class="streaming">streaming…</span>
      <span class="flex-1" />
      <span class="view-toggle">
        <button
          :class="{ on: view === 'rendered' }"
          title="markdown preview"
          @click="view = 'rendered'"
        >
          rendered
        </button>
        <button :class="{ on: view === 'raw' }" title="exact output" @click="view = 'raw'">
          raw
        </button>
      </span>
      <button class="text-btn" :title="copied ? 'copied' : 'copy output'" @click="copy">
        {{ copied ? "copied ✓" : "copy" }}
      </button>
      <button
        class="text-btn"
        :title="expanded ? 'collapse' : 'expand'"
        @click="expanded = !expanded"
      >
        {{ expanded ? "collapse" : "expand" }}
      </button>
    </div>

    <div v-if="view === 'rendered'" class="md-body out" :class="{ expanded }" v-html="html" />
    <pre v-else class="out" :class="{ expanded }">{{ card.output }}</pre>
  </article>
</template>

<style scoped>
.result-enter {
  animation: tau-enter var(--t-med) var(--ease) both;
  animation-delay: v-bind(enterDelay);
}

.card-eyebrow {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 8px;
}

.eyebrow-label {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--tau-faint); /* tau.faint */
}

.intent-text {
  color: var(--tau-muted); /* tau.muted */
  font-size: 12px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 320px;
}

.tally {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--tau-faint); /* tau.faint */
}

.streaming {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--tau-ok); /* tau.ok */
  animation: tau-pulse 1.1s ease-in-out infinite;
}

.view-toggle {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--tau-line); /* tau.line */
  border-radius: 6px;
  overflow: hidden;
  flex: none;
}

.view-toggle button {
  background: transparent;
  border: 0;
  color: var(--tau-faint); /* tau.faint */
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 2px 8px;
  cursor: pointer;
  transition:
    color var(--t-fast) var(--ease),
    background-color var(--t-fast) var(--ease);
}

.view-toggle button.on {
  color: var(--tau-ok); /* tau.ok */
  background: var(--tau-ok-soft);
}

.text-btn {
  background: transparent;
  border: 0;
  color: var(--tau-faint); /* tau.faint */
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 2px 4px;
  cursor: pointer;
  transition: color var(--t-fast) var(--ease);
}

.text-btn:hover {
  color: var(--tau-muted); /* tau.muted */
}

.out {
  margin: 10px 0 0;
  padding: 10px 12px;
  background: var(--tau-bg); /* tau.bg */
  border: 1px solid var(--tau-line); /* tau.line */
  border-radius: 8px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  color: var(--tau-muted); /* tau.muted */
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 15rem;
  overflow: auto;
}

.out.expanded {
  max-height: none;
}

/* shiki blocks replace the inner pre — blend them into the card shell */
.out :deep(pre.shiki) {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
