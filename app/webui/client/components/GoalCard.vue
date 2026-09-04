<script setup lang="ts">
/**
 * GoalCard — the agent-mode surface (issue #97). A goal is a timeline of
 * ROUNDS, each with its plan, deterministic review badge, live-streaming
 * steps, and terminal status. Medium+ rounds pause the stream inline: the
 * card shows Approve/Stop — the same gate the plan card provides, per
 * round, never a blanket pre-approval. The Stop button aborts the fetch;
 * the server cancels the goal (process-group kill mid-shell included).
 *
 * v0.5.0 (issue #110): the AI's per-round reasoning renders as a
 * ThinkingPanel on each round (collapsed once the round lands), deltas
 * still streaming show in a pinned live rail above the timeline, and tool
 * steps render as structured ToolCallCards (risk badge from the /api/tools
 * inventory, args JSON, live output) instead of one-line labels.
 *
 * Visual language matches PlanCard: tau-card/tau-surface shell, eyebrow
 * row, mono labels, one chrome action at a time (Approve while paused,
 * Stop while streaming).
 */
import { computed, nextTick, ref, watch } from "vue";
import { renderMarkdown } from "@tau/markdown";
import type { GoalCardState, GoalRoundState } from "../composables/plan-flow.js";
import { useSession } from "../composables/session.js";
import { attachHtmlPreviews } from "../lib/preview.js";
import RiskBadge from "./RiskBadge.vue";
import ThinkingPanel from "./ThinkingPanel.vue";
import ToolCallCard from "./ToolCallCard.vue";

const props = defineProps<{ card: GoalCardState; enterIndex?: number }>();

const emit = defineEmits<{
  approve: [card: GoalCardState, approved: boolean];
  stop: [card: GoalCardState];
}>();

const { tools } = useSession();

/** Tool risk from the /api/tools inventory — "" when unknown (badge hidden). */
function toolRisk(name: string | undefined): string {
  if (!name) return "";
  return tools.value.find((tool) => tool.name === name)?.risk ?? "";
}

const enterDelay = computed(() => `${Math.min((props.enterIndex ?? 0) * 40, 200)}ms`);
const answerHtml = computed(() => (props.card.answer ? renderMarkdown(props.card.answer) : ""));

// Sandboxed html-block previews in the final answer (issue #136) — the
// same progressive attach pattern as ResultCard (no shiki pass here;
// answer fences render escaped until previewed).
const answerEl = ref<HTMLElement | null>(null);
watch(answerHtml, () => {
  void nextTick(() => {
    if (answerEl.value) attachHtmlPreviews(answerEl.value);
  });
});
const liveThinkingActive = computed(
  () => props.card.streaming && props.card.status === "running" && !!props.card.liveThinking,
);

const GOAL_STATUS_LABEL: Record<GoalCardState["status"], string> = {
  running: "running",
  ok: "complete",
  failed: "failed",
  cancelled: "stopped",
  denied: "denied",
  max_rounds: "round cap",
};

function roundStatusClass(round: GoalRoundState): string {
  if (round.approvalPending) return "st-await";
  if (!round.status) return "st-run";
  return round.status === "ok" ? "st-ok" : "st-bad";
}

function roundStatusLabel(round: GoalRoundState): string {
  if (round.approvalPending) return "awaiting approval";
  if (!round.status) return "running";
  return round.status === "ok" ? "ok" : round.status;
}
</script>

<template>
  <article
    class="tau-card tau-surface plan-enter"
    :class="{ 'goal-denied': card.status === 'denied' }"
  >
    <!-- eyebrow: GOAL label + provider + live dot -->
    <div class="card-eyebrow">
      <span class="eyebrow-label">goal</span>
      <span class="eyebrow-meta">
        round {{ card.rounds.length
        }}<template v-if="card.maxRounds > 0">/{{ card.maxRounds }}</template> · via
        {{ card.provider || "provider" }}
      </span>
      <span v-if="card.streaming && card.status === 'running'" class="live-dot" title="streaming" />
    </div>

    <!-- intent -->
    <p class="goal-intent">{{ card.intent }}</p>

    <!-- live thinking rail: deltas stream here before their round lands -->
    <ThinkingPanel
      v-if="card.liveThinking"
      :thinking="card.liveThinking"
      :active="liveThinkingActive"
    />

    <!-- rounds timeline -->
    <ol class="round-list">
      <li v-for="round in card.rounds" :key="round.round" class="round-item">
        <div class="round-head">
          <span class="round-index">R{{ round.round }}</span>
          <span
            v-if="round.origin === 'reflect'"
            class="origin-chip"
            title="proposed by the AI after reflecting on the previous round"
            >AI continuation</span
          >
          <RiskBadge v-if="round.review" :level="round.review.overallRisk" />
          <span class="round-status" :class="roundStatusClass(round)">{{
            roundStatusLabel(round)
          }}</span>
        </div>

        <!-- this round's provider reasoning, collapsed once the round lands -->
        <ThinkingPanel
          v-if="round.thinking"
          :thinking="round.thinking"
          :duration-ms="round.thinkingMs"
        />

        <p v-if="round.plan?.explanation" class="round-expl">{{ round.plan.explanation }}</p>

        <!-- live steps: tool calls as structured cards, shell as raw rows -->
        <ol class="step-stream">
          <li
            v-for="step in round.steps"
            :key="step.index"
            :class="{ 'step-live': step.step?.kind !== 'tool' }"
          >
            <ToolCallCard
              v-if="step.step?.kind === 'tool'"
              :step="step.step"
              :output="step.output"
              :running="step.running"
              :ok="step.ok"
              :skipped="step.skipped"
              :risk="toolRisk(step.step.tool)"
            />
            <template v-else>
              <div class="step-line">
                <span
                  class="step-dot"
                  :class="
                    step.running
                      ? 'dot-run'
                      : step.skipped
                        ? 'dot-skip'
                        : step.ok
                          ? 'dot-ok'
                          : 'dot-bad'
                  "
                />
                <code class="step-label">{{ step.label }}</code>
              </div>
              <pre v-if="step.output" class="step-out">{{ step.output }}</pre>
            </template>
          </li>
        </ol>

        <!-- approval pause: the per-round gate -->
        <div v-if="round.approvalPending" class="approval-bar">
          <span class="approval-text">
            round {{ round.round }} is not low-risk — nothing runs until you decide
          </span>
          <div class="approval-actions">
            <button class="run-btn tau-chrome-bg" @click="emit('approve', card, true)">
              Approve round
            </button>
            <button class="tau-btn tau-btn-danger-hover" @click="emit('approve', card, false)">
              Refuse
            </button>
          </div>
        </div>
        <p v-else-if="round.approvalTimedOut" class="approval-timeout">
          approval timed out — the goal stopped
        </p>
      </li>
    </ol>

    <!-- final answer -->
    <div v-if="card.answer" ref="answerEl" class="goal-answer md-body" v-html="answerHtml" />

    <!-- error -->
    <div v-if="card.error" class="goal-error">
      <span class="issue-mark">▌</span>
      <span class="issue-label">error</span>
      <span class="issue-msg">{{ card.error }}</span>
    </div>

    <!-- footer status + stop -->
    <div class="goal-foot">
      <span class="goal-status" :class="`status-${card.status}`">{{
        GOAL_STATUS_LABEL[card.status]
      }}</span>
      <span class="flex-1" />
      <button
        v-if="card.streaming && card.status === 'running'"
        class="tau-btn tau-btn-danger-hover"
        @click="emit('stop', card)"
      >
        Stop goal
      </button>
    </div>
  </article>
</template>

<style scoped>
.goal-intent {
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--tau-text); /* tau.text */
  margin: 2px 0 10px;
  white-space: pre-wrap;
  word-break: break-word;
}

.round-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.round-item {
  border: 1px solid var(--tau-line); /* tau.line */
  border-radius: 10px;
  background: var(--tau-raised); /* tau.raised */
  padding: 10px 12px;
}

.round-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.round-index {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--tau-muted); /* tau.muted */
  background: var(--tau-active); /* tau.active */
  border: 1px solid var(--tau-line-strong); /* tau.line-strong */
  border-radius: 6px;
  padding: 1px 6px;
}

.origin-chip {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--tau-info);
  border: 1px dashed var(--tau-info);
  border-radius: 6px;
  padding: 1px 6px;
}

.round-status {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 10.5px;
}

.st-run {
  color: var(--tau-info);
}
.st-await {
  color: var(--tau-warn);
}
.st-ok {
  color: var(--tau-ok);
}
.st-bad {
  color: var(--tau-danger);
}

.round-expl {
  font-size: 12.5px;
  color: var(--tau-muted); /* tau.muted */
  line-height: 1.5;
  margin: 2px 0 6px;
}

.step-stream {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.step-live {
  border-left: 2px solid var(--tau-line); /* tau.line */
  padding-left: 10px;
}

.step-live.running {
  border-left-color: var(--tau-info);
}

.step-line {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.step-dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.dot-run {
  background: var(--tau-info);
  animation: tau-pulse 1.1s var(--ease) infinite;
}

.dot-ok {
  background: var(--tau-ok);
}
.dot-skip {
  background: var(--tau-placeholder);
}
.dot-bad {
  background: var(--tau-danger);
}

.step-label {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--tau-text); /* tau.text */
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.step-out {
  margin: 4px 0 0;
  padding: 6px 8px;
  background: var(--tau-bg); /* tau.bg */
  border: 1px solid var(--tau-line); /* tau.line */
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  color: var(--tau-muted); /* tau.muted */
  max-height: 200px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.approval-bar {
  margin-top: 8px;
  border: 1px solid var(--tau-warn);
  border-radius: 8px;
  background: color-mix(in srgb, var(--tau-warn) 8%, transparent);
  padding: 8px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.approval-text {
  font-size: 12px;
  color: var(--tau-text); /* tau.text */
}

.approval-actions {
  display: flex;
  gap: 8px;
  margin-left: auto;
}

.approval-timeout {
  margin-top: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--tau-warn);
}

.goal-answer {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--tau-line); /* tau.line */
}

.goal-error {
  margin-top: 8px;
  display: flex;
  gap: 6px;
  align-items: baseline;
  font-size: 12px;
}

.issue-mark {
  color: var(--tau-danger);
}
.issue-label {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--tau-danger);
  text-transform: uppercase;
}
.issue-msg {
  color: var(--tau-muted);
  overflow-wrap: anywhere;
}

.goal-foot {
  margin-top: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.goal-status {
  font-family: var(--font-mono);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}

.status-running {
  color: var(--tau-info);
}
.status-ok {
  color: var(--tau-ok);
}
.status-failed,
.status-denied {
  color: var(--tau-danger);
}
.status-cancelled {
  color: var(--tau-muted);
}
.status-max_rounds {
  color: var(--tau-warn);
}

.live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--tau-info);
  margin-left: auto;
  animation: tau-pulse 1.1s var(--ease) infinite;
}
</style>
