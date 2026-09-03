<script setup lang="ts">
/**
 * ThinkingPanel — the provider-thinking disclosure (v0.5.0, issue #110).
 * While deltas stream in, the panel stays open with a pulsing "thinking"
 * label; once the turn ends it collapses to a one-line summary ("Thought
 * for 4s") that toggles on click — the reasoning is one click away but
 * never in the way. Body text is mono/muted: it is machine reasoning, kept
 * visually secondary to the plan prose.
 */
import { computed, ref } from "vue";

const props = defineProps<{
  /** The accumulated reasoning text (grows live while `active`). */
  thinking: string;
  /** True while deltas are still arriving (panel pinned open). */
  active?: boolean;
  /** Wall-clock thinking duration; rendered once inactive ("Thought for Ns"). */
  durationMs?: number;
  /** Collapsed by default once done — flip here for a different default. */
  defaultOpen?: boolean;
}>();

const manuallyToggled = ref(false);
const open = ref(props.defaultOpen ?? false);

const isOpen = computed(() => {
  if (props.active) return true; // live thinking is pinned open
  if (manuallyToggled.value) return open.value;
  return props.defaultOpen ?? false;
});

function toggle(): void {
  manuallyToggled.value = true;
  open.value = !isOpen.value;
}

const seconds = computed(() => {
  const ms = props.durationMs ?? 0;
  return ms > 0 ? Math.max(1, Math.round(ms / 1000)) : 0;
});

const summary = computed(() => (seconds.value > 0 ? `Thought for ${seconds.value}s` : "Thought"));
</script>

<template>
  <section class="think-panel" :class="{ active }">
    <button class="think-head" type="button" @click="toggle">
      <span v-if="active" class="think-dot" />
      <span class="think-label">{{ active ? "Thinking…" : summary }}</span>
      <svg
        class="think-chevron"
        :class="{ open: isOpen }"
        width="10"
        height="10"
        viewBox="0 0 10 10"
        fill="none"
        aria-hidden="true"
      >
        <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.4" />
      </svg>
    </button>
    <pre v-if="isOpen && thinking" class="think-body">{{ thinking }}</pre>
  </section>
</template>

<style scoped>
.think-panel {
  margin: 0 0 8px;
  border: 1px solid var(--tau-line);
  border-radius: 8px;
  background: var(--tau-bg);
  overflow: hidden;
}

.think-panel.active {
  border-color: var(--tau-info-edge);
}

.think-head {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: none;
  border: none;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--tau-muted);
  text-align: left;
}

.think-head:hover {
  color: var(--tau-text);
}

.think-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--tau-info);
  animation: tau-pulse 1.1s var(--ease) infinite;
  flex: none;
}

.think-label {
  flex: 1;
}

.think-chevron {
  flex: none;
  transition: transform var(--t-fast) var(--ease);
}

.think-chevron.open {
  transform: rotate(180deg);
}

.think-body {
  margin: 0;
  padding: 8px 10px;
  border-top: 1px solid var(--tau-line);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.55;
  color: var(--tau-muted);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 220px;
  overflow: auto;
}
</style>
