<script setup lang="ts">
/**
 * PlanCard — the review surface. Everything the safety gate will act on is
 * on the card: the steps, the deterministic verdict, the issues, the plugin
 * warnings. High-risk confirmation is card-local state (explicit intent, no
 * global checkbox). Deny verdicts hard-disable Run.
 *
 * `Run plan` is the chrome primary action — the only non-identity element
 * that carries the gradient sweep. It marks "this is the gate control."
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
  <article ref="rootEl" class="tau-card tau-surface plan-enter">
    <!-- eyebrow: PLAN label + risk badge + provider -->
    <div class="card-eyebrow">
      <span class="eyebrow-label">plan</span>
      <RiskBadge :level="card.review.overallRisk" />
      <span class="eyebrow-meta">via {{ card.providerLabel || card.provider }}</span>
    </div>

    <!-- markdown preview (escaped-first renderer, see @tau/markdown) -->
    <div class="md-body md-lead" v-html="explanation" />

    <!-- steps on a numbered rail -->
    <ol v-if="card.plan.steps?.length" class="step-list">
      <StepRow v-for="(step, s) in card.plan.steps" :key="s" :step="step" :index="s" />
    </ol>
    <p v-else class="empty-plan">empty plan</p>

    <!-- issues -->
    <div v-if="issues.length" class="issues">
      <p
        v-for="(issue, ii) in issues"
        :key="ii"
        class="issue"
        :class="issue.level === 'blocked' ? 'issue-blocked' : 'issue-caution'"
      >
        <span class="issue-mark">{{ issue.level === "blocked" ? "▌" : "▌" }}</span>
        <span class="issue-label">{{ issue.level === "blocked" ? "blocked" : "caution" }}</span>
        <span class="issue-msg">{{ issue.message }}</span>
      </p>
    </div>

    <!-- plugin warnings -->
    <p v-for="(warning, wi) in card.warnings" :key="'w' + wi" class="plugin-warn">
      <span class="issue-mark">▌</span>
      <span class="issue-label">plugin</span>
      <span class="issue-msg">{{ warning }}</span>
    </p>

    <!-- deny banner -->
    <div v-if="card.review.verdict === 'deny'" class="deny-banner">
      The safety review denied this plan. It cannot be executed here.
    </div>

    <!-- actions: Run plan (chrome primary) + Discard (ghost) + high-risk checkbox -->
    <div class="actions">
      <button class="run-btn tau-chrome-bg" :disabled="!runnable" @click="emit('run', card)">
        <span v-if="card.running" class="running-dot" />
        <svg
          v-else
          class="run-icon"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
        >
          <path d="M3 2L10 6L3 10V2Z" fill="currentColor" />
        </svg>
        <span class="run-label">{{ card.running ? "Running" : "Run plan" }}</span>
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
        class="high-risk-check"
      >
        <input v-model="card.confirmHighRisk" type="checkbox" class="high-risk-box" />
        <span>high risk — run it</span>
      </label>
    </div>
  </article>
</template>

<style scoped>
.plan-enter {
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

.eyebrow-meta {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--tau-faint); /* tau.faint */
}

.step-list {
  list-style: none;
  margin: 12px 0 0;
  padding: 0 0 0 12px;
  border-left: 1px solid var(--tau-line); /* tau.line */
}

.empty-plan {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--tau-faint); /* tau.faint */
}

.issues {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.issue,
.plugin-warn {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.issue-mark {
  flex: none;
}

.issue-blocked,
.issue-blocked .issue-mark,
.issue-blocked .issue-label {
  color: var(--tau-danger); /* tau.danger */
}

.issue-caution,
.issue-caution .issue-mark,
.issue-caution .issue-label,
.plugin-warn,
.plugin-warn .issue-mark,
.plugin-warn .issue-label {
  color: var(--tau-warn); /* tau.warn */
}

.issue-msg {
  color: var(--tau-muted); /* tau.muted */
  flex: 1;
  min-width: 0;
}

.deny-banner {
  margin-top: 10px;
  border: 1px solid var(--tau-danger-edge);
  background: var(--tau-danger-soft);
  color: var(--tau-danger); /* tau.danger */
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12px;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
  align-items: center;
}

.run-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 36px;
  padding: 0 16px;
  border: 1px solid var(--tau-chrome-3);
  border-radius: 8px;
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  color: var(--tau-on-chrome); /* constant light — chrome sweep is self-colored */
  transition:
    background-position var(--t-slow) var(--ease),
    border-color var(--t-fast) var(--ease),
    opacity var(--t-fast) var(--ease);
}

.run-btn:hover:not(:disabled) {
  background-position: 100% 50%;
  border-color: var(--tau-chrome-4);
}

.run-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.run-icon {
  color: var(--tau-on-chrome); /* on the chrome sweep, not on the panel */
}

.running-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--tau-ok); /* tau.ok */
  display: inline-block;
  animation: tau-pulse 1s var(--ease) infinite;
}

.run-label {
  line-height: 1;
}

.high-risk-check {
  display: flex;
  gap: 6px;
  align-items: center;
  color: var(--tau-warn); /* tau.warn */
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}

.high-risk-box {
  width: 14px;
  height: 14px;
  accent-color: var(--tau-warn);
  cursor: pointer;
}
</style>
