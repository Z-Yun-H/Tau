<script setup lang="ts">
/**
 * Tau WebUI — shell. Composition only: the state lives in composables, the
 * pieces in components/. Layout contract:
 *   ≥1024px  two independent scroll areas (chat column | reference rail)
 *   <1024px  one scrolling flow — chat, sticky composer, then the rail
 * Execution stays gated exactly like the CLI: nothing runs before Run plan.
 */
import { nextTick, onMounted, ref, watch } from "vue";
import Composer from "./components/Composer.vue";
import EmptyState from "./components/EmptyState.vue";
import ErrorCard from "./components/ErrorCard.vue";
import PlanCard from "./components/PlanCard.vue";
import ResultCard from "./components/ResultCard.vue";
import SidePanel from "./components/SidePanel.vue";
import StatusHeader from "./components/StatusHeader.vue";
import { usePlanFlow } from "./composables/plan-flow.js";
import { useSession } from "./composables/session.js";
const { cards, planning, submitIntent, runPlan, discard } = usePlanFlow();

const streamEl = ref<HTMLElement | null>(null);

onMounted(() => {
  const { refreshStatus, refreshSkills, refreshHistory } = useSession();
  void refreshStatus();
  void refreshSkills();
  void refreshHistory();
});

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
</script>

<template>
  <StatusHeader />
  <main
    class="flex-1 min-h-0 w-full max-w-[1400px] mx-auto flex flex-col gap-3 px-4 py-3 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:overflow-hidden"
  >
    <!-- chat column -->
    <section class="flex flex-col min-h-0">
      <div
        ref="streamEl"
        aria-live="polite"
        class="flex-1 min-h-0 overflow-y-auto pr-1.5 lg:overflow-y-auto"
      >
        <EmptyState v-if="cards.length === 0" />

        <template v-for="(card, i) in cards" :key="card.id">
          <PlanCard
            v-if="card.type === 'plan'"
            :card="card"
            :enter-index="i"
            @run="runPlan"
            @discard="discard"
          />
          <ResultCard v-else-if="card.type === 'result'" :card="card" :enter-index="i" />
          <ErrorCard v-else :card="card" :enter-index="i" />
        </template>
      </div>

      <Composer class="composer-dock" :planning="planning" @submit="submitIntent" />
    </section>

    <!-- reference rail: side column on desktop, section below the chat on narrow screens -->
    <SidePanel class="max-h-[45vh] lg:max-h-none" />
  </main>
</template>

<style scoped>
@media (max-width: 1023px) {
  .composer-dock {
    position: sticky;
    bottom: 0;
    background: #0a0d12; /* tau.bg0 */
    padding-bottom: 4px;
  }
}
</style>
