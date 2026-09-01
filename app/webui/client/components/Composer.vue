<script setup lang="ts">
/**
 * Composer — the intent input. Enter submits, Shift+Enter is a newline, the
 * textarea auto-grows up to a cap. The hint row documents the keyboard
 * contract inline (`?` opens the full panel). Sticky at the bottom of the
 * chat column on narrow screens.
 */
import { ref, watch } from "vue";

const props = defineProps<{ planning: boolean }>();
const emit = defineEmits<{ submit: [intent: string] }>();

const intent = ref("");
const input = ref<HTMLTextAreaElement | null>(null);

function autoGrow(): void {
  const el = input.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
}

watch(intent, autoGrow);

function onSubmit(): void {
  const text = intent.value.trim();
  if (!text || props.planning) return;
  intent.value = "";
  emit("submit", text);
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    onSubmit();
  }
}

function focus(): void {
  input.value?.focus();
}

defineExpose({ focus });
</script>

<template>
  <form class="flex flex-col gap-1.5 pt-3" @submit.prevent="onSubmit">
    <textarea
      ref="input"
      v-model="intent"
      class="tau-input resize-none min-h-[38px] max-h-[160px] leading-5.5"
      rows="1"
      autocomplete="off"
      spellcheck="false"
      aria-label="intent"
      placeholder="e.g. list ts files under src — 自然语言也可以"
      :disabled="planning"
      @keydown="onKeydown"
    />
    <div class="flex items-center justify-between gap-2">
      <p class="m-0 font-mono text-[10px] text-tau-faint select-none">
        <kbd class="tau-kbd">Enter</kbd> send · <kbd class="tau-kbd">Shift+Enter</kbd> newline ·
        <button
          type="button"
          class="bg-transparent border-0 p-0 cursor-pointer font-mono text-[10px] text-tau-faint underline decoration-dotted underline-offset-2 hover:text-tau-muted"
          @click="focus()"
        >
          <kbd class="tau-kbd">Ctrl+K</kbd>
        </button>
        focus ·
        <kbd class="tau-kbd">?</kbd> all shortcuts
      </p>
      <button type="submit" class="tau-btn-primary flex-none" :disabled="planning">
        {{ planning ? "planning…" : "Plan" }}
      </button>
    </div>
  </form>
</template>
