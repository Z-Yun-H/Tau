<script setup lang="ts">
/**
 * Tau WebUI — shell, agent-mode layout. Composition only: state lives in
 * composables, pieces in components/.
 *
 *   ≥1024px  chat threads (left) | conversation stream (center) | reference
 *            rail (right, Alt+S toggleable)
 *   <1024px  single scrolling flow — the thread list becomes an overlay
 *            drawer behind the ☰ chats button
 *
 * Keyboard contract (see ShortcutsModal): Enter send · Shift+Enter newline ·
 * Ctrl/⌘+K focus composer · ? shortcuts · Alt+N new thread · Alt+S rail.
 *
 * Execution stays gated exactly like the CLI: nothing runs before Run plan —
 * threads are a UI grouping over the same /api/plan → /api/execute pipeline,
 * never an independent execution path.
 */
import { nextTick, onMounted, ref, watch } from "vue";
import { useEventListener, watchDebounced } from "@vueuse/core";
import Composer from "./components/Composer.vue";
import EmptyState from "./components/EmptyState.vue";
import ErrorCard from "./components/ErrorCard.vue";
import PlanCard from "./components/PlanCard.vue";
import ResultCard from "./components/ResultCard.vue";
import SessionSidebar from "./components/SessionSidebar.vue";
import ShortcutsModal from "./components/ShortcutsModal.vue";
import SidePanel from "./components/SidePanel.vue";
import StatusHeader from "./components/StatusHeader.vue";
import { usePlanFlow } from "./composables/plan-flow.js";
import { useSession } from "./composables/session.js";

const { cards, planning, submitIntent, runPlan, discard, createThread } = usePlanFlow();

const streamEl = ref<HTMLElement | null>(null);
const composer = ref<InstanceType<typeof Composer> | null>(null);
const shortcutsOpen = ref(false);
const railOpen = ref(true);
const sidebarOpen = ref(false);

function onKeydown(event: KeyboardEvent): void {
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === "k") {
    event.preventDefault();
    composer.value?.focus();
    return;
  }
  if (event.key === "Escape") {
    if (shortcutsOpen.value) shortcutsOpen.value = false;
    return;
  }
  if (event.altKey && !event.ctrlKey && !event.metaKey) {
    if (key === "n") {
      event.preventDefault();
      createThread();
    } else if (key === "s") {
      event.preventDefault();
      railOpen.value = !railOpen.value;
    }
    return;
  }
  if (event.key === "?") {
    const target = event.target;
    const empty =
      target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement
        ? target.value === ""
        : false;
    if (empty) {
      event.preventDefault();
      shortcutsOpen.value = true;
    }
  }
}

onMounted(() => {
  const { refreshStatus, refreshSkills, refreshHistory } = useSession();
  void refreshStatus();
  void refreshSkills();
  void refreshHistory();
});

// vueuse useEventListener — auto cleanup on unmount
useEventListener(window, "keydown", onKeydown);

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
// faster than the content grows.
watchDebounced(
  () => cards.value.reduce((n, c) => (c.type === "result" ? n + c.output.length : n), 0),
  () => scrollToEnd(),
  { debounce: 150, maxWait: 600 },
);
</script>

<template>
  <StatusHeader />
  <main
    class="flex-1 min-h-0 w-full max-w-[1600px] mx-auto flex flex-col gap-3 px-4 py-3 lg:grid lg:overflow-hidden"
    :class="
      railOpen ? 'lg:grid-cols-[240px_minmax(0,1fr)_320px]' : 'lg:grid-cols-[240px_minmax(0,1fr)]'
    "
  >
    <!-- chat threads: overlay drawer on narrow screens, first column on lg+ -->
    <div
      v-if="sidebarOpen"
      class="fixed inset-0 z-30 bg-black/55 lg:hidden"
      @click="sidebarOpen = false"
    />
    <SessionSidebar
      class="fixed inset-y-0 left-0 z-40 w-[280px] rounded-none border-y-0 border-l-0 transition-transform duration-200 ease-out lg:static lg:z-auto lg:w-auto lg:translate-x-0 lg:rounded-10px lg:border"
      :class="sidebarOpen ? 'translate-x-0' : '-translate-x-full'"
      @navigate="sidebarOpen = false"
    />

    <!-- conversation stream -->
    <section class="flex flex-col min-h-0">
      <div class="flex items-center gap-2 mb-1 lg:hidden">
        <button class="tau-btn !py-1 text-[12px]" @click="sidebarOpen = true">chats</button>
      </div>
      <div
        ref="streamEl"
        aria-live="polite"
        class="flex-1 min-h-0 overflow-y-auto pr-1.5 flex flex-col lg:overflow-y-auto"
      >
        <EmptyState v-if="cards.length === 0" />

        <template v-for="(card, i) in cards" :key="card.id">
          <div v-if="card.type === 'user'" class="user-row">
            <div class="user-bubble" :title="card.ts">{{ card.text }}</div>
          </div>
          <PlanCard
            v-else-if="card.type === 'plan'"
            :card="card"
            :enter-index="i"
            @run="runPlan"
            @discard="discard"
          />
          <ResultCard v-else-if="card.type === 'result'" :card="card" :enter-index="i" />
          <ErrorCard v-else :card="card" :enter-index="i" />
        </template>
      </div>

      <Composer ref="composer" class="composer-dock" :planning="planning" @submit="submitIntent" />
    </section>

    <!-- reference rail: side column on desktop, section below the chat on narrow screens -->
    <SidePanel v-if="railOpen" class="max-h-[45vh] lg:max-h-none" />
  </main>

  <ShortcutsModal v-if="shortcutsOpen" @close="shortcutsOpen = false" />
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

.user-row {
  display: flex;
  justify-content: flex-end;
  margin: 10px 0 2px;
  animation: tau-enter var(--t-med) var(--ease) both;
}

.user-bubble {
  max-width: 78%;
  background: #1c2430; /* tau.active */
  border: 1px solid #2a3342; /* tau.line-strong */
  color: #e3e9f0; /* tau.text */
  border-radius: 10px;
  padding: 6px 11px;
  font-size: 13px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
