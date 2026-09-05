<script setup lang="ts">
/**
 * ConversationStream — the chat content column (issue #151 extraction):
 * the user's bubbles + the card rail (plan / result / goal / error) and
 * the empty state, plus the two autoscroll behaviors (follow new cards;
 * follow live streamed output growth, debounced). State comes from the
 * usePlanFlow() singleton — no props; the composer stays outside (App
 * keeps it docked below this column).
 */
import { nextTick, ref, watch } from "vue";
import { watchDebounced } from "@vueuse/core";
import AttachmentChips from "./AttachmentChips.vue";
import EmptyState from "./EmptyState.vue";
import ErrorCard from "./ErrorCard.vue";
import GoalCard from "./GoalCard.vue";
import PlanCard from "./PlanCard.vue";
import ResultCard from "./ResultCard.vue";
import { streamVolume, usePlanFlow } from "../composables/plan-flow.js";

const { cards, runPlan, approveGoal, cancelGoal, discard } = usePlanFlow();

const streamEl = ref<HTMLElement | null>(null);

// Keep the newest card in view, but never steal scroll while the user reads up.
function scrollToEnd(): void {
  void nextTick(() => {
    streamEl.value?.scrollTo({ top: streamEl.value.scrollHeight, behavior: "smooth" });
  });
}

watch(
  () => cards.value.length,
  () => scrollToEnd(),
);

// Streaming autoscroll: follow live output growth (debounced so per-chunk
// updates do not thrash smooth scrolling) — never steals scroll position
// faster than the content grows. Goal streams count too (step outputs +
// round growth are the agent-mode live content).
watchDebounced(
  () => streamVolume(cards.value),
  () => scrollToEnd(),
  { debounce: 150, maxWait: 600 },
);
</script>

<template>
  <div ref="streamEl" aria-live="polite" class="stream-scroll flex-1 min-h-0 overflow-y-auto">
    <div class="stream-inner">
      <EmptyState v-if="cards.length === 0" />

      <template v-for="(card, i) in cards" :key="card.id">
        <div v-if="card.type === 'user'" class="user-row">
          <div class="user-col">
            <div class="user-bubble" :title="card.ts">{{ card.text }}</div>
            <AttachmentChips
              v-if="card.attachments?.length"
              class="user-attach"
              :items="card.attachments"
            />
          </div>
        </div>
        <PlanCard
          v-else-if="card.type === 'plan'"
          :card="card"
          :enter-index="i"
          @run="runPlan"
          @discard="discard"
        />
        <ResultCard v-else-if="card.type === 'result'" :card="card" :enter-index="i" />
        <GoalCard
          v-else-if="card.type === 'goal'"
          :card="card"
          :enter-index="i"
          @approve="approveGoal"
          @stop="cancelGoal"
        />
        <ErrorCard v-else :card="card" :enter-index="i" />
      </template>
    </div>
  </div>
</template>

<style scoped>
.stream-scroll {
  /* The conversation column scrolls independently on lg+; on smaller it
     is the main page scroll. */
  scroll-behavior: smooth;
}

.stream-inner {
  /* Center the conversation content with a max width matching the composer
     so the active turn reads as the focal column. */
  width: 100%;
  max-width: 768px;
  margin: 0 auto;
  padding: 16px 16px 8px;
  display: flex;
  flex-direction: column;
}

@media (min-width: 1024px) {
  .stream-inner {
    padding: 20px 20px 8px;
  }
}

.user-row {
  display: flex;
  justify-content: flex-end;
  margin: 12px 0 4px;
  animation: tau-enter var(--t-med) var(--ease) both;
}

/* bubble + attachment chips stack right-aligned (issue #135) */
.user-col {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  max-width: 78%;
}

.user-attach {
  justify-content: flex-end;
}

.user-bubble {
  max-width: 100%;
  background: var(--tau-active); /* tau.active */
  border: 1px solid var(--tau-line-strong); /* tau.line-strong */
  color: var(--tau-text); /* tau.text */
  border-radius: 12px;
  border-bottom-right-radius: 4px;
  padding: 8px 12px;
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
