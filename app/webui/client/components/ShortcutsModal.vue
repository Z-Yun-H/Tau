<script setup lang="ts">
/**
 * ShortcutsModal — the keyboard contract, one overlay. Opened by `?` (when
 * the composer is empty) or the hint row under the composer; closed by Esc,
 * backdrop click, or the close button.
 */
import RiskBadge from "./RiskBadge.vue";

const emit = defineEmits<{ close: [] }>();

const ROWS: { keys: string; action: string }[] = [
  { keys: "Enter", action: "send the intent" },
  { keys: "Shift + Enter", action: "newline in the composer" },
  { keys: "Ctrl/⌘ + K", action: "focus the composer" },
  { keys: "?", action: "open this panel (composer empty)" },
  { keys: "Alt + N", action: "new conversation" },
  { keys: "Alt + S", action: "toggle the reference rail" },
  { keys: "Alt + T", action: "cycle theme system → light → dark" },
  { keys: "Esc", action: "close this panel" },
];
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-panel tau-panel" role="dialog" aria-label="shortcuts">
      <div class="modal-head">
        <span class="eyebrow-label">shortcuts</span>
        <RiskBadge level="low" label="client-only" />
        <span class="flex-1" />
        <button class="tau-btn !px-2.5 !py-1 text-[11px]" @click="emit('close')">esc</button>
      </div>
      <table class="modal-table">
        <tbody>
          <tr v-for="row in ROWS" :key="row.keys" class="modal-row">
            <td class="modal-keys">
              <kbd class="tau-kbd">{{ row.keys }}</kbd>
            </td>
            <td class="modal-action">{{ row.action }}</td>
          </tr>
        </tbody>
      </table>
      <p class="modal-foot">the safety gate is untouched: nothing runs until you press Run plan</p>
    </div>
  </div>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--tau-backdrop);
  padding: 16px;
  animation: tau-enter var(--t-med) var(--ease) both;
}

.modal-panel {
  width: 100%;
  max-width: 440px;
  padding: 18px 20px;
}

.modal-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.eyebrow-label {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--tau-faint); /* tau.faint */
}

.modal-table {
  width: 100%;
  margin-top: 10px;
  border-collapse: collapse;
}

.modal-row {
  vertical-align: baseline;
}

.modal-keys {
  padding: 7px 14px 7px 0;
  white-space: nowrap;
}

.modal-action {
  padding: 7px 0;
  font-family: var(--font-sans);
  font-size: 12.5px;
  color: var(--tau-muted); /* tau.muted */
}

.modal-foot {
  margin: 12px 0 0;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--tau-faint); /* tau.faint */
}
</style>
