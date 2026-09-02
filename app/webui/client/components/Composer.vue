<script setup lang="ts">
/**
 * Composer — the intent input. chat.z.ai-inspired beam composer: a single
 * rounded panel with a soft shadow, a rotating conic-gradient beam border
 * on focus-within, and a chrome Send button. Enter submits, Shift+Enter is
 * a newline, the textarea auto-grows up to a cap. Sticky at the bottom of
 * the chat column on narrow screens.
 *
 * The Send button is NOT labeled "Plan" — the composer *sends an intent*;
 * the plan card *runs the plan*. Two actions, two controls.
 */
import { computed, ref, watch } from "vue";

const props = defineProps<{ planning: boolean }>();
const emit = defineEmits<{ submit: [intent: string] }>();

const intent = ref("");
const input = ref<HTMLTextAreaElement | null>(null);
const focused = ref(false);

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

const canSend = computed(() => intent.value.trim().length > 0 && !props.planning);

defineExpose({ focus });
</script>

<template>
  <form class="composer-form" @submit.prevent="onSubmit">
    <div
      class="composer-beam"
      :class="{ focused, 'has-content': intent.length > 0 }"
      @focusin="focused = true"
      @focusout="focused = false"
    >
      <div class="composer-shell">
        <textarea
          ref="input"
          v-model="intent"
          class="composer-text"
          rows="1"
          autocomplete="off"
          spellcheck="false"
          aria-label="intent"
          placeholder="Describe what you want Tau to do…"
          :disabled="planning"
          @keydown="onKeydown"
        />

        <div class="composer-toolbar">
          <div class="toolbar-left">
            <span class="hint">
              <kbd class="tau-kbd">⌘K</kbd>
              <span class="hint-text">focus</span>
            </span>
            <span class="hint-sep">·</span>
            <button type="button" class="hint-btn" title="press ? when focused" @click="focus">
              <kbd class="tau-kbd">?</kbd>
              <span class="hint-text">shortcuts</span>
            </button>
          </div>

          <button
            type="submit"
            class="send-btn"
            :class="{ ready: canSend }"
            :disabled="!canSend"
            :title="planning ? 'planning…' : canSend ? 'send (Enter)' : 'type to send'"
            aria-label="send"
          >
            <svg
              v-if="!planning"
              class="send-icon"
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <path d="M3 8.5L13 4L11.5 13L8.5 10.5L6.5 12.5L6 9L3 8.5Z" fill="currentColor" />
            </svg>
            <span v-else class="send-spinner" aria-label="planning" />
          </button>
        </div>
      </div>
    </div>
  </form>
</template>

<style scoped>
.composer-form {
  width: 100%;
  max-width: 768px;
  margin: 0 auto;
}

.composer-beam {
  position: relative;
  border-radius: 12px;
  padding: 1.5px;
  background: linear-gradient(180deg, var(--tau-faint) 0%, var(--tau-line-strong) 100%);
  transition:
    background var(--t-fast) var(--ease),
    box-shadow var(--t-med) var(--ease);
  box-shadow: var(--tau-elev-2);
}

.composer-beam.focused {
  background: conic-gradient(
    from var(--beam-angle, 0deg),
    var(--tau-ok) 0deg,
    var(--tau-info) 80deg,
    var(--tau-chrome-5) 160deg,
    var(--tau-chrome-5) 180deg,
    var(--tau-chrome-5) 200deg,
    var(--tau-info) 280deg,
    var(--tau-ok) 360deg
  );
  animation: tau-beam 3s linear infinite;
  box-shadow: var(--tau-elev-3);
}

.composer-shell {
  background: var(--tau-panel); /* tau.panel */
  border-radius: 11px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.composer-text {
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--tau-text); /* tau.text */
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.5;
  padding: 12px 14px 4px;
  resize: none;
  min-height: 44px;
  max-height: 160px;
  display: block;
}

.composer-text::placeholder {
  color: var(--tau-placeholder); /* tau.placeholder */
}

.composer-text:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.composer-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px 6px 12px;
  border-top: 1px solid var(--tau-line); /* tau.line */
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.hint,
.hint-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--tau-faint); /* tau.faint */
  background: transparent;
  border: 0;
  padding: 0;
  cursor: default;
  user-select: none;
}

.hint-btn {
  cursor: pointer;
  text-decoration: underline;
  text-decoration-style: dotted;
  text-underline-offset: 2px;
  transition: color var(--t-fast) var(--ease);
}

.hint-btn:hover {
  color: var(--tau-muted); /* tau.muted */
}

.hint-text {
  /* Hide the text on very narrow screens; the kbd alone reads fine. */
}

@media (max-width: 480px) {
  .hint-text {
    display: none;
  }
  .hint-sep {
    display: none;
  }
}

.hint-sep {
  color: var(--tau-placeholder);
  font-family: var(--font-mono);
  font-size: 10px;
}

.send-btn {
  flex: none;
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--tau-raised); /* tau.raised */
  color: var(--tau-faint); /* tau.faint */
  border: 1px solid var(--tau-line-strong); /* tau.line-strong */
  border-radius: 8px;
  cursor: not-allowed;
  padding: 0;
  transition:
    background-image var(--t-slow) var(--ease),
    color var(--t-fast) var(--ease),
    border-color var(--t-fast) var(--ease),
    background-position var(--t-slow) var(--ease);
}

.send-btn.ready {
  background-image: linear-gradient(
    90deg,
    var(--tau-chrome-1) 0%,
    var(--tau-chrome-3) 30%,
    var(--tau-chrome-5) 50%,
    var(--tau-chrome-3) 70%,
    var(--tau-chrome-1) 100%
  );
  background-size: 200% 100%;
  background-position: 0% 50%;
  color: var(--tau-bg); /* tau.bg — icon sits on chrome */
  border-color: var(--tau-chrome-3);
  cursor: pointer;
}

.send-btn.ready:hover {
  background-position: 100% 50%;
}

.send-btn.ready:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.send-icon {
  display: block;
}

.send-spinner {
  width: 12px;
  height: 12px;
  border: 1.5px solid currentColor;
  border-top-color: transparent;
  border-radius: 50%;
  animation: tau-pulse 1.1s var(--ease) infinite;
  display: inline-block;
}
</style>
