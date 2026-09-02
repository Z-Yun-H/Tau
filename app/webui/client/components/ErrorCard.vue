<script setup lang="ts">
/**
 * ErrorCard — a failed plan request (provider missing, offline, bad key).
 * Shows the intent, the actual message, and the two concrete ways out.
 */
import { computed } from "vue";
import type { ErrorCardState } from "../composables/plan-flow.js";

const props = defineProps<{ card: ErrorCardState; enterIndex?: number }>();
const enterDelay = computed(() => `${Math.min((props.enterIndex ?? 0) * 40, 200)}ms`);
</script>

<template>
  <article class="tau-card error-enter">
    <div class="card-eyebrow">
      <span class="eyebrow-label">error</span>
      <span class="intent-text" :title="card.intent">{{ card.intent }}</span>
    </div>
    <p class="error-msg">{{ card.message }}</p>
    <p class="error-hint">
      configure a key with <code class="inline-code">tau provider set-key</code>, or run offline
      with <code class="inline-code">tau config set provider mock</code>
    </p>
  </article>
</template>

<style scoped>
.error-enter {
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

.intent-text {
  color: var(--tau-muted); /* tau.muted */
  font-size: 12px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 320px;
}

.error-msg {
  margin: 8px 0 0;
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--tau-danger); /* tau.danger */
  line-height: 1.5;
  word-break: break-word;
}

.error-hint {
  margin: 6px 0 0;
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--tau-faint); /* tau.faint */
  line-height: 1.5;
}

.inline-code {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--tau-muted); /* tau.muted */
  background: var(--tau-raised); /* tau.raised */
  border: 1px solid var(--tau-line); /* tau.line */
  border-radius: 4px;
  padding: 0 4px;
}
</style>
