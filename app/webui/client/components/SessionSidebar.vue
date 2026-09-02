<script setup lang="ts">
/**
 * SessionSidebar — local conversation threads (localStorage-persisted, see
 * plan-flow.ts). Newest first; two-step inline delete (no window.confirm,
 * no accidental loss: the first click arms, the second confirms). The
 * server-side history remains the durable record — this is a UI rail.
 *
 * Fused with the app bg (no separate panel bg on desktop); separated by
 * a single hairline border on the right. The `+ new conversation`
 * primary action sits full-width at the top.
 */
import { computed, ref } from "vue";
import { usePlanFlow, type Thread } from "../composables/plan-flow.js";
import { relTime } from "../lib/format.js";

const emit = defineEmits<{ navigate: [] }>();

const { threads, currentId, createThread, switchThread, removeThread } = usePlanFlow();

const sorted = computed(() =>
  [...threads.value].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
);

const armedId = ref(0);
const armed = computed(() => (armedId.value !== 0 ? String(armedId.value) : ""));

function select(thread: Thread): void {
  switchThread(thread.id);
  armedId.value = 0;
  emit("navigate");
}

function arm(thread: Thread): void {
  armedId.value = armedId.value === thread.id ? 0 : thread.id;
}

function confirmRemove(thread: Thread): void {
  removeThread(thread.id);
  armedId.value = 0;
}
</script>

<template>
  <aside class="sidebar-shell tau-surface flex flex-col min-h-0 overflow-hidden lg:rounded-12px">
    <!-- new conversation: chrome primary action, full width -->
    <div class="px-2.5 pt-2.5 pb-2 flex-none">
      <button class="new-btn tau-chrome-bg w-full" @click="createThread()">
        <span class="font-mono text-[12px]">+ new conversation</span>
      </button>
    </div>

    <hr class="tau-divider flex-none" />

    <!-- thread list -->
    <div class="overflow-y-auto flex-1 min-h-0 py-1.5">
      <p v-if="sorted.length === 0" class="panel-empty px-3">no conversations yet</p>
      <div
        v-for="thread in sorted"
        :key="thread.id"
        class="thread-row"
        :class="{ active: thread.id === currentId, armed: armed === String(thread.id) }"
        role="button"
        tabindex="0"
        @click="select(thread)"
        @keydown.enter.prevent="select(thread)"
      >
        <div class="min-w-0 flex-1">
          <p class="m-0 text-[13px] text-tau-text truncate font-medium">{{ thread.title }}</p>
          <p class="m-0 mt-0.5 font-mono text-[10px] text-tau-faint">
            {{ thread.cards.length }} card(s) · {{ relTime(thread.updatedAt) }}
          </p>
        </div>
        <button
          v-if="armed !== String(thread.id)"
          class="row-action"
          title="delete conversation"
          @click.stop="arm(thread)"
        >
          ✕
        </button>
        <button
          v-else
          class="row-action armed"
          title="click again to confirm delete"
          @click.stop="confirmRemove(thread)"
        >
          del?
        </button>
      </div>
    </div>

    <hr class="tau-divider flex-none" />

    <!-- footer hint -->
    <div class="px-3 py-2 flex-none">
      <p class="m-0 font-mono text-[10px] text-tau-faint">
        <kbd class="tau-kbd">Alt+N</kbd> new · <kbd class="tau-kbd">Ctrl+K</kbd> focus
      </p>
    </div>
  </aside>
</template>

<style scoped>
.sidebar-shell {
  /* On narrow screens (drawer), fill the column. On lg+, the rounded
     panel sits inside the grid cell. */
  width: 100%;
}

.new-btn {
  height: 36px;
  border-radius: 8px;
  border: 1px solid var(--tau-chrome-3);
  cursor: pointer;
  color: var(--tau-on-chrome); /* constant light on the self-colored sweep */
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition:
    background-position var(--t-slow) var(--ease),
    border-color var(--t-fast) var(--ease);
}

.new-btn:hover {
  background-position: 100% 50%;
  border-color: var(--tau-chrome-4);
}

.thread-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 2px 8px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid transparent;
  cursor: pointer;
  transition:
    background-color var(--t-fast) var(--ease),
    border-color var(--t-fast) var(--ease);
}

.thread-row:hover {
  background: var(--tau-raised); /* tau.raised */
}

.thread-row.active {
  background: var(--tau-active); /* tau.active */
  border-color: var(--tau-line-strong); /* tau.line-strong */
}

.thread-row.armed {
  border-color: var(--tau-danger-edge);
}

.row-action {
  flex: none;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--tau-faint); /* tau.faint */
  border: 1px solid var(--tau-line); /* tau.line */
  border-radius: 6px;
  font-size: 10px;
  font-family: var(--font-mono);
  cursor: pointer;
  padding: 0;
  transition:
    color var(--t-fast) var(--ease),
    border-color var(--t-fast) var(--ease),
    background-color var(--t-fast) var(--ease);
}

.row-action:hover {
  color: var(--tau-text); /* tau.text */
  border-color: var(--tau-line-strong); /* tau.line-strong */
  background: var(--tau-raised); /* tau.raised */
}

.row-action.armed {
  color: var(--tau-danger); /* tau.danger */
  border-color: var(--tau-danger);
  background: var(--tau-danger-soft);
}

.row-action.armed:hover {
  background: var(--tau-danger-soft);
}

.panel-empty {
  margin: 0;
  font-size: 12px;
  color: var(--tau-faint); /* tau.faint */
}
</style>
