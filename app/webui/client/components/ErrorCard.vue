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
    <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span class="font-mono text-[11px] uppercase tracking-1px text-tau-faint">error</span>
      <span class="text-tau-muted text-[12px] min-w-0 truncate" :title="card.intent">
        {{ card.intent }}
      </span>
    </div>
    <p class="m-0 mt-1.5 text-[13px] text-tau-danger font-mono">{{ card.message }}</p>
    <p class="m-0 mt-1 text-[12px] text-tau-faint">
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

.inline-code {
  font-family: var(--font-mono);
  font-size: 11px;
  color: #93a0af; /* tau.text1 */
  background: #151b24; /* tau.bg2 */
  border: 1px solid #1e2530; /* tau.line0 */
  border-radius: 4px;
  padding: 0 4px;
}
</style>
