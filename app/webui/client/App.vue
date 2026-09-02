<script setup lang="ts">
/**
 * Tau WebUI — shell, agent-mode layout. Composition only: state lives in
 * composables, pieces in components/.
 *
 *   ≥1024px  chat threads (left, 260px) | conversation stream (center,
 *            composer max-w-768 centered) | reference rail (right, 320px,
 *            Alt+S toggleable) — each column scrolls independently,
 *            viewport-locked (h-dvh).
 *   <1024px  single scrolling flow — the thread list becomes an overlay
 *            drawer behind the ☰ chats button; the reference rail moves
 *            below the chat (max-h 45vh); the composer is sticky at the
 *            bottom.
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
import GoalCard from "./components/GoalCard.vue";
import PlanCard from "./components/PlanCard.vue";
import ResultCard from "./components/ResultCard.vue";
import SessionSidebar from "./components/SessionSidebar.vue";
import ShortcutsModal from "./components/ShortcutsModal.vue";
import SettingsPanel from "./components/SettingsPanel.vue";
import SidePanel from "./components/SidePanel.vue";
import StatusHeader from "./components/StatusHeader.vue";
import { usePlanFlow } from "./composables/plan-flow.js";
import { useSession } from "./composables/session.js";
import { useTheme } from "./lib/theme.js";

const {
  cards,
  planning,
  submitIntent,
  runPlan,
  submitGoal,
  approveGoal,
  cancelGoal,
  discard,
  createThread,
} = usePlanFlow();
const { cyclePreference: cycleTheme } = useTheme();

// Composer mode (issue #97): plan (default, historical flow) | agent (goal loop).
const agentMode = ref(false);

const streamEl = ref<HTMLElement | null>(null);
const composer = ref<InstanceType<typeof Composer> | null>(null);
const shortcutsOpen = ref(false);
const settingsOpen = ref(false);
const railOpen = ref(true);
const sidebarOpen = ref(false);

function onKeydown(event: KeyboardEvent): void {
  const key = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && key === "k") {
    event.preventDefault();
    composer.value?.focus();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && !event.altKey && key === ",") {
    event.preventDefault();
    settingsOpen.value = true;
    return;
  }
  if (event.key === "Escape") {
    if (shortcutsOpen.value) shortcutsOpen.value = false;
    if (settingsOpen.value) settingsOpen.value = false;
    if (sidebarOpen.value) sidebarOpen.value = false;
    return;
  }
  if (event.altKey && !event.ctrlKey && !event.metaKey) {
    if (key === "n") {
      event.preventDefault();
      createThread();
    } else if (key === "s") {
      event.preventDefault();
      railOpen.value = !railOpen.value;
    } else if (key === "t") {
      event.preventDefault();
      cycleTheme();
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
// faster than the content grows. Goal streams count too (step outputs +
// round growth are the agent-mode live content).
watchDebounced(
  () =>
    cards.value.reduce((n, c) => {
      if (c.type === "result") return n + c.output.length;
      if (c.type === "goal") {
        return (
          n +
          c.rounds.reduce(
            (sum, round) => sum + round.steps.reduce((acc, step) => acc + step.output.length, 0),
            0,
          )
        );
      }
      return n;
    }, 0),
  () => scrollToEnd(),
  { debounce: 150, maxWait: 600 },
);
</script>

<template>
  <StatusHeader @open-settings="settingsOpen = true" />
  <main
    class="app-shell flex-1 min-h-0 w-full mx-auto flex flex-col lg:grid lg:overflow-hidden"
    :class="
      railOpen ? 'lg:grid-cols-[260px_minmax(0,1fr)_320px]' : 'lg:grid-cols-[260px_minmax(0,1fr)]'
    "
  >
    <!-- chat threads: overlay drawer on narrow screens, first column on lg+ -->
    <div
      v-if="sidebarOpen"
      class="fixed inset-0 z-30 bg-black/55 lg:hidden backdrop-blur-0"
      @click="sidebarOpen = false"
    />
    <SessionSidebar
      class="sidebar-dock fixed inset-y-0 left-0 z-40 w-[280px] lg:static lg:z-auto lg:w-auto lg:translate-x-0 transition-transform duration-200 ease-out"
      :class="sidebarOpen ? 'translate-x-0' : '-translate-x-full'"
      @navigate="sidebarOpen = false"
    />

    <!-- conversation stream -->
    <section class="flex flex-col min-h-0">
      <!-- narrow-screen top bar: drawer toggle + rail toggle -->
      <div class="flex items-center gap-2 px-3 py-2 lg:hidden flex-none">
        <button
          class="tau-btn !py-1 !px-2 text-[12px]"
          title="open conversation list (Alt+N for new)"
          @click="sidebarOpen = true"
        >
          <span class="font-mono">≡</span> chats
        </button>
        <span class="flex-1" />
        <button
          class="tau-btn !py-1 !px-2 text-[12px]"
          :title="railOpen ? 'hide reference rail (Alt+S)' : 'show reference rail (Alt+S)'"
          @click="railOpen = !railOpen"
        >
          {{ railOpen ? "hide rail" : "show rail" }}
        </button>
      </div>

      <hr class="tau-divider flex-none lg:hidden" />

      <div ref="streamEl" aria-live="polite" class="stream-scroll flex-1 min-h-0 overflow-y-auto">
        <div class="stream-inner">
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

      <Composer
        ref="composer"
        class="composer-dock"
        :planning="planning"
        :agent-mode="agentMode"
        @submit="(intent: string) => (agentMode ? submitGoal(intent) : submitIntent(intent))"
        @mode="(agent: boolean) => (agentMode = agent)"
      />
    </section>

    <!-- reference rail: side column on desktop, section below the chat on narrow screens -->
    <SidePanel v-if="railOpen" class="max-h-[45vh] lg:max-h-none" />
  </main>

  <ShortcutsModal v-if="shortcutsOpen" @close="shortcutsOpen = false" />
  <SettingsPanel v-if="settingsOpen" @close="settingsOpen = false" />
</template>

<style scoped>
.app-shell {
  /* On lg+, the grid handles layout; on smaller, it's a flex column.
     Content max-width and padding are tuned per breakpoint. */
  padding: 0;
}

@media (min-width: 1024px) {
  .app-shell {
    padding: 12px;
    gap: 12px;
    max-width: 1600px;
  }
}

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

/* Composer dock: on narrow screens, sticky at the bottom so it stays
   visible while the conversation scrolls. On lg+, it docks in the flex
   column naturally. */
.composer-dock {
  padding: 0 16px 12px;
}

@media (min-width: 1024px) {
  .composer-dock {
    padding: 0 20px 16px;
  }
}

@media (max-width: 1023px) {
  .composer-dock {
    position: sticky;
    bottom: 0;
    background: var(--tau-bg); /* tau.bg */
    padding-bottom: 12px;
    z-index: 10;
  }
}

.user-row {
  display: flex;
  justify-content: flex-end;
  margin: 12px 0 4px;
  animation: tau-enter var(--t-med) var(--ease) both;
}

.user-bubble {
  max-width: 78%;
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
