<script setup lang="ts">
/**
 * ResultCard — the execution outcome. Status badge + an honest per-step
 * tally (ok / skipped / failed counts) before the raw output, so a long
 * output never hides what actually happened to each step.
 */
import { computed } from "vue";
import type { ResultCardState } from "../composables/plan-flow.js";
import RiskBadge from "./RiskBadge.vue";

const props = defineProps<{ card: ResultCardState; enterIndex?: number }>();

const enterDelay = computed(() => `${Math.min((props.enterIndex ?? 0) * 40, 200)}ms`);

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
  props.card.status === "ok" ? "ok" : props.card.status === "denied" ? "blocked" : "danger",
);
</script>

<template>
  <article class="tau-card result-enter">
    <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span class="font-mono text-[11px] uppercase tracking-1px text-tau-faint">result</span>
      <span class="text-tau-muted text-[12px] min-w-0 truncate" :title="card.intent">
        {{ card.intent }}
      </span>
      <RiskBadge :level="statusLevel" :label="card.status" />
      <span v-if="tally" class="font-mono text-[11px] text-tau-faint">{{ tally }}</span>
    </div>
    <pre class="out">{{ card.output }}</pre>
  </article>
</template>

<style scoped>
.result-enter {
  animation: tau-enter var(--t-med) var(--ease) both;
  animation-delay: v-bind(enterDelay);
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
</style>
