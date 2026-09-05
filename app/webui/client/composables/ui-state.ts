/**
 * UI chrome state (issue #151 extraction) — which overlay surface is open
 * (shortcuts / settings). Module-singleton like session.ts: the keyboard
 * loop in App.vue, slash commands, and the header button all flip the same
 * refs, and ModalLayer renders whichever is open. Esc closes any of them.
 */
import { ref } from "vue";

const shortcutsOpen = ref(false);
const settingsOpen = ref(false);

export function useUiState() {
  function closeOverlays(): void {
    shortcutsOpen.value = false;
    settingsOpen.value = false;
  }
  return { shortcutsOpen, settingsOpen, closeOverlays };
}
