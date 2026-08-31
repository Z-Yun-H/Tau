<script setup lang="ts">
/**
 * Composer — the intent input. Submit on Enter; the Plan button carries the
 * pending state (a pulsing ellipsis, not a spinner theatre). Sticky at the
 * bottom of the chat column on narrow screens.
 */
import { ref } from "vue";

const props = defineProps<{ planning: boolean }>();
const emit = defineEmits<{ submit: [intent: string] }>();

const intent = ref("");

function onSubmit(): void {
  const text = intent.value.trim();
  if (!text || props.planning) return;
  intent.value = "";
  emit("submit", text);
}
</script>

<template>
  <form class="flex gap-2 pt-3" @submit.prevent="onSubmit">
    <input
      v-model="intent"
      class="tau-input"
      type="text"
      autocomplete="off"
      spellcheck="false"
      aria-label="intent"
      placeholder="e.g. list ts files under src — 自然语言也可以"
      :disabled="planning"
    />
    <button type="submit" class="tau-btn-primary flex-none" :disabled="planning">
      {{ planning ? "planning…" : "Plan" }}
    </button>
  </form>
</template>
