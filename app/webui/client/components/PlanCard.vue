<script setup lang="ts">
/**
 * PlanCard — the review surface. Everything the safety gate will act on is
 * on the card: the steps, the deterministic verdict, the issues, the plugin
 * warnings. High-risk confirmation is card-local state (explicit intent, no
 * global checkbox). Deny verdicts hard-disable Run.
 */
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { renderMarkdown } from "@tau/markdown";
import type { PlanCardState } from "../composables/plan-flow.js";
import { highlightPreBlocks } from "../lib/highlight.js";
import RiskBadge from "./RiskBadge.vue";
import StepRow from "./StepRow.vue";

const props = defineProps<{
  card: PlanCardState;
  enterIndex?: number;
}>();

const emit = defineEmits<{ run: [card: PlanCardState]; discard: [card: PlanCardState] }>();

const runnable = computed(() => props.card.review.verdict !== "deny" && !props.card.running);
const issues = computed(() => props.card.review.issues ?? []);
const enterDelay = computed(() => `${Math.min((props.enterIndex ?? 0) * 40, 200)}ms`);
const explanation = computed(() =>
  renderMarkdown(props.card.plan.explanation || `“${props.card.intent}”`),
);

const rootEl = ref<HTMLElement | null>(null);
onMounted(() => {
  void nextTick(() => {
    if (rootEl.value) void highlightPreBlocks(rootEl.value);
  });
});
</script>

<template>
  <article ref="rootEl" class="tau-card plan-enter">
    <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span class="font-mono text-[11px] uppercase tracking-1px text-tau-faint">plan</span>
      <RiskBadge :level="card.review.overallRisk" />
      <span class="font-mono text-[11px] text-tau-faint">
        via {{ card.providerLabel || card.provider }}
      </span>
    </div>
    <!-- markdown preview (escaped-first renderer, see lib/markdown.ts) -->
    <div class="md-body md-lead" v-html="explanation" />

    <ol
      v-if="card.plan.steps?.length"
      class="list-none m-0 mt-2 px-0 border-l border-tau-line pl-3"
    >
      <StepRow v-for="(step, s) in card.plan.steps" :key="s" :step="step" :index="s" />
    </ol>
    <p v-else class="m-0 mt-2 text-[12px] text-tau-faint">empty plan</p>

    <div v-if="issues.length" class="mt-2 flex flex-col gap-0.5">
      <p
        v-for="(issue, ii) in issues"
        :key="ii"
        class="m-0 text-[12px] font-mono"
        :class="issue.level === 'blocked' ? 'text-tau-danger' : 'text-tau-warn'"
      >
        {{ issue.level === "blocked" ? "▌ blocked" : "▌ caution" }} {{ issue.message }}
      </p>
    </div>

    <p
      v-for="(warning, wi) in card.warnings"
      :key="'w' + wi"
      class="m-0 mt-0.5 text-[12px] font-mono text-tau-warn"
    >
      ▌ plugin {{ warning }}
    </p>

    <div
      v-if="card.review.verdict === 'deny'"
      class="mt-2.5 border border-tau-danger/40 bg-tau-danger/10 text-tau-danger rounded-6px px-2.5 py-1.5 text-[12px]"
    >
      The safety review denied this plan. It cannot be executed here.
    </div>

    <div class="flex flex-wrap gap-2 mt-3 items-center">
      <button class="tau-btn-primary" :disabled="!runnable" @click="emit('run', card)">
        <span
          v-if="card.running"
          class="running-dot w-1.5 h-1.5 rounded-full bg-tau-ok inline-block"
        />
        {{ card.running ? "Running" : "Run plan" }}
      </button>
      <button
        class="tau-btn tau-btn-danger-hover"
        :disabled="card.running"
        @click="emit('discard', card)"
      >
        Discard
      </button>
      <label
        v-if="card.review.overallRisk === 'high' && card.review.verdict !== 'deny'"
        class="flex gap-1.5 items-center text-tau-warn text-[12px] cursor-pointer select-none"
      >
        <input
          v-model="card.confirmHighRisk"
          type="checkbox"
          class="accent-tau-warn w-3.5 h-3.5 cursor-pointer"
        />
        high risk — run it
      </label>
    </div>
  </article>
</template>

<style scoped>
.plan-enter {
  animation: tau-enter var(--t-med) var(--ease) both;
  animation-delay: v-bind(enterDelay);
}

.running-dot {
  animation: tau-pulse 1s var(--ease) infinite;
}
</style>
