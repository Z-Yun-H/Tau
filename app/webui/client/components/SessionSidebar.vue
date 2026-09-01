<script setup lang="ts">
/**
 * SessionSidebar — local conversation threads (localStorage-persisted, see
 * plan-flow.ts). Newest first; two-step inline delete (no window.confirm,
 * no accidental loss: the first click arms, the second confirms). The
 * server-side history remains the durable record — this is a UI rail.
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
  <aside class="tau-panel flex flex-col min-h-0 overflow-hidden">
    <div class="flex items-center gap-2 px-2.5 py-2 border-b border-tau-line flex-none">
      <span class="font-mono text-[10px] uppercase tracking-1px text-tau-faint">chats</span>
      <span class="flex-1" />
      <button class="tau-btn-primary !px-2 !py-0.5 text-[11px]" @click="createThread()">
        + new
      </button>
    </div>

    <div class="overflow-y-auto flex-1 min-h-0 py-1">
      <p v-if="sorted.length === 0" class="panel-empty px-2.5">no conversations yet</p>
      <div
        v-for="thread in sorted"
        :key="thread.id"
        class="thread-row"
        :class="{ active: thread.id === currentId }"
        role="button"
        tabindex="0"
        @click="select(thread)"
        @keydown.enter.prevent="select(thread)"
      >
        <div class="min-w-0 flex-1">
          <p class="m-0 text-[12.5px] text-tau-text truncate">{{ thread.title }}</p>
          <p class="m-0 font-mono text-[10px] text-tau-faint">
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
          class="row-action text-tau-danger !border-tau-danger/60"
          title="click again to confirm delete"
          @click.stop="confirmRemove(thread)"
        >
          del?
        </button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.thread-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 2px 6px;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid transparent;
  cursor: pointer;
  transition:
    background-color var(--t-fast) var(--ease),
    border-color var(--t-fast) var(--ease);
}

.thread-row:hover {
  background: #151b24; /* tau.raised */
}

.thread-row.active {
  background: #1c2430; /* tau.active */
  border-color: #2a3342; /* tau.line-strong */
}

.row-action {
  flex: none;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: #5c6878; /* tau.faint */
  border: 1px solid #1e2530; /* tau.line */
  border-radius: 4px;
  font-size: 10px;
  font-family: var(--font-mono);
  cursor: pointer;
  padding: 0;
  transition:
    color var(--t-fast) var(--ease),
    border-color var(--t-fast) var(--ease);
}

.row-action:hover {
  color: #e3e9f0; /* tau.text */
  border-color: #2a3342; /* tau.line-strong */
}

.panel-empty {
  margin: 0;
  font-size: 12px;
  color: #5c6878; /* tau.text2 */
}
</style>
