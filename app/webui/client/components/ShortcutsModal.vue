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
  { keys: "Esc", action: "close this panel" },
];
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4"
    @click.self="emit('close')"
  >
    <div class="tau-panel w-full max-w-[420px] px-4 py-3.5" role="dialog" aria-label="shortcuts">
      <div class="flex items-center gap-2">
        <span class="font-mono text-[11px] uppercase tracking-1px text-tau-faint">shortcuts</span>
        <RiskBadge level="low" label="client-only" />
        <span class="flex-1" />
        <button class="tau-btn !px-2 !py-0.5 text-[11px]" @click="emit('close')">esc</button>
      </div>
      <table class="w-full mt-2 border-collapse">
        <tbody>
          <tr v-for="row in ROWS" :key="row.keys" class="align-baseline">
            <td class="py-1 pr-3 whitespace-nowrap">
              <kbd class="tau-kbd">{{ row.keys }}</kbd>
            </td>
            <td class="py-1 text-[12.5px] text-tau-muted">{{ row.action }}</td>
          </tr>
        </tbody>
      </table>
      <p class="m-0 mt-2 font-mono text-[10px] text-tau-faint">
        the safety gate is untouched: nothing runs until you press Run plan
      </p>
    </div>
  </div>
</template>
