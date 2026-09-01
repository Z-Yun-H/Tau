<script setup lang="ts">
/**
 * ResultCard — the execution outcome. Status badge + an honest per-step
 * tally before the output. Preview controls: rendered/raw toggle (markdown
 * preview vs the exact bytes), one-click copy, and expand for long output.
 * The raw view is always one click away — the preview never hides what the
 * steps actually printed.
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
  <article ref="rootEl" class="tau-card result-enter">
    <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span class="font-mono text-[11px] uppercase tracking-1px text-tau-faint">result</span>
      <span class="text-tau-muted text-[12px] min-w-0 truncate" :title="card.intent">
        {{ card.intent }}
      </span>
      <RiskBadge :level="statusLevel" :label="card.status" />
      <span v-if="tally" class="font-mono text-[11px] text-tau-faint">{{ tally }}</span>
      <span v-if="card.streaming" class="font-mono text-[11px] text-tau-ok tau-pulse"
        >streaming…</span
      >
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
      <button
        class="view-toggle !border-0 !bg-transparent"
        :title="copied ? 'copied' : 'copy output'"
        @click="copy"
      >
        {{ copied ? "copied ✓" : "copy" }}
      </button>
      <button
        class="view-toggle !border-0 !bg-transparent"
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

.view-toggle {
  display: inline-flex;
  align-items: center;
  border: 1px solid #1e2530; /* tau.line */
  border-radius: 4px;
  overflow: hidden;
  flex: none;
}

.view-toggle button {
  background: transparent;
  border: 0;
  color: #5c6878; /* tau.faint */
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 1px 7px;
  cursor: pointer;
  transition:
    color var(--t-fast) var(--ease),
    background-color var(--t-fast) var(--ease);
}

.view-toggle button.on {
  color: #5ec97a; /* tau.ok */
  background: rgba(94, 201, 122, 0.1);
}

.out {
  margin: 8px 0 0;
  padding: 8px 10px;
  background: #0a0d12; /* tau.bg0 */
  border: 1px solid #1e2530; /* tau.line0 */
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  color: #93a0af; /* tau.text1 */
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
  padding: 8px 10px;
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.tau-pulse {
  animation: tau-pulse 1.1s ease-in-out infinite;
}

@keyframes tau-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.45;
  }
}
</style>
