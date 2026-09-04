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
 *
 * Mode segmented control (issue #97): `plan` = the historical single-round
 * flow (plan → review → Run plan gate); `agent` = multi-round goal loop
 * (rounds stream live, medium+ rounds pause for per-round approval). The
 * toggle is a default-on-plan UI switch — the plan path is untouched.
 *
 * Slash menu (issue #133): typing a bare command token (`/`, `/th`, …)
 * opens a floating menu fed by the shared command catalog (server:
 * /api/commands). ↑/↓ move, Tab/Enter execute, Esc dismisses; commands are
 * executed CLIENT-side (never sent as intents) and clear the composer.
 *
 * Image attachments (issue #135): the paperclip button, paste (clipboard
 * files) and drag-and-drop all feed the same validated draft list; drafts
 * render as removable chips with data-URL previews and ride the submit
 * event. Sending with images but no text uses an explicit default intent
 * so the server's required-intent contract stays intact.
 */
import { computed, ref, watch } from "vue";
import type { CommandInfo } from "../lib/api.js";
import {
  FILE_ACCEPT_ATTR,
  MAX_ATTACHMENTS,
  filesToDrafts,
  type AttachmentDraft,
} from "../lib/attachments.js";
import {
  clampIndex,
  filterCommands,
  menuOpenFor,
  type SlashActionId,
  type SlashMenuItem,
} from "../lib/slash.js";
import AttachmentChips from "./AttachmentChips.vue";

const props = defineProps<{
  planning: boolean;
  agentMode?: boolean;
  /** Shared catalog entries (webui surface) from /api/commands. */
  commands?: CommandInfo[];
}>();
const emit = defineEmits<{
  submit: [intent: string, attachments: AttachmentDraft[]];
  mode: [agent: boolean];
  command: [action: SlashActionId];
}>();

const intent = ref("");
const input = ref<HTMLTextAreaElement | null>(null);
const focused = ref(false);
const dismissed = ref(false);
const menuIndex = ref(0);

/** Image drafts (issue #135) + the first validation error of the last batch. */
const attachments = ref<AttachmentDraft[]>([]);
const attachError = ref("");
const fileInput = ref<HTMLInputElement | null>(null);
const dragging = ref(false);
let dragDepth = 0;

/** Fallback intent when the user sends images without any text. */
const DEFAULT_IMAGE_INTENT = "Analyze the attached image(s).";

const chipItems = computed(() =>
  attachments.value.map((draft) => ({
    ...(draft.name ? { name: draft.name } : {}),
    mediaType: draft.mediaType,
    bytes: draft.bytes,
    thumb: draft.dataUrl,
  })),
);

/** Paperclip / paste / drop all funnel here (all-or-nothing per batch). */
async function addFiles(files: FileList | File[] | null | undefined): Promise<void> {
  if (!files || files.length === 0 || props.planning) return;
  const { drafts, error } = await filesToDrafts(files, attachments.value.length);
  if (error) {
    attachError.value = error;
    return;
  }
  if (drafts.length === 0) return;
  attachError.value = "";
  attachments.value.push(...drafts);
}

function removeAttachment(index: number): void {
  attachments.value.splice(index, 1);
}

function pickFiles(): void {
  if (!props.planning) fileInput.value?.click();
}

function onFilesPicked(event: Event): void {
  const el = event.target as HTMLInputElement;
  void addFiles(el.files);
  el.value = ""; // re-picking the same file must fire change again
}

function onPaste(event: ClipboardEvent): void {
  const files = event.clipboardData?.files;
  if (files && files.length > 0) {
    event.preventDefault(); // don't paste a file path as text
    void addFiles(files);
  }
}

function onDragEnter(event: DragEvent): void {
  if (event.dataTransfer?.types.includes("Files")) {
    dragDepth += 1;
    dragging.value = true;
  }
}

function onDragLeave(): void {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dragging.value = false;
}

function onDrop(event: DragEvent): void {
  dragDepth = 0;
  dragging.value = false;
  void addFiles(event.dataTransfer?.files);
}

const menuItems = computed<SlashMenuItem[]>(() =>
  dismissed.value ? [] : filterCommands(props.commands ?? [], intent.value),
);
const menuVisible = computed(() => menuOpenFor(intent.value) && menuItems.value.length > 0);

watch(intent, () => {
  dismissed.value = false;
  menuIndex.value = 0;
});

watch(menuItems, () => {
  menuIndex.value = clampIndex(menuIndex.value, menuItems.value.length);
});

function runCommand(item: SlashMenuItem): void {
  intent.value = "";
  emit("command", item.action);
}

function moveMenu(delta: number): void {
  menuIndex.value = clampIndex(menuIndex.value + delta, menuItems.value.length);
}

function autoGrow(): void {
  const el = input.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
}

watch(intent, autoGrow);

function onSubmit(): void {
  const text = intent.value.trim();
  const hasImages = attachments.value.length > 0;
  if ((!text && !hasImages) || props.planning) return;
  const finalIntent = text || DEFAULT_IMAGE_INTENT;
  const drafts = attachments.value;
  intent.value = "";
  attachments.value = [];
  attachError.value = "";
  emit("submit", finalIntent, drafts);
}

function onKeydown(event: KeyboardEvent): void {
  if (menuVisible.value) {
    if (event.key === "ArrowDown" || (event.ctrlKey && event.key.toLowerCase() === "n")) {
      event.preventDefault();
      moveMenu(1);
      return;
    }
    if (event.key === "ArrowUp" || (event.ctrlKey && event.key.toLowerCase() === "p")) {
      event.preventDefault();
      moveMenu(-1);
      return;
    }
    if (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey && !event.isComposing)) {
      event.preventDefault();
      const item = menuItems.value[menuIndex.value];
      if (item !== undefined) runCommand(item);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      dismissed.value = true;
      return;
    }
  }
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    onSubmit();
  }
}

function focus(): void {
  input.value?.focus();
}

const canSend = computed(
  () => (intent.value.trim().length > 0 || attachments.value.length > 0) && !props.planning,
);

/** Exposed for the slash-command paths that clear/blur the composer. */
function clearAttachments(): void {
  attachments.value = [];
  attachError.value = "";
}

defineExpose({ focus, clearAttachments });
</script>

<template>
  <form class="composer-form" @submit.prevent="onSubmit">
    <div
      class="composer-beam"
      :class="{ focused, 'has-content': intent.length > 0, dragging }"
      @focusin="focused = true"
      @focusout="focused = false"
      @dragenter.prevent="onDragEnter"
      @dragover.prevent="dragging = true"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
    >
      <!-- slash menu floats ABOVE the beam; outside the shell's overflow clip -->
      <div
        v-if="menuVisible && focused"
        class="slash-menu tau-surface"
        role="listbox"
        aria-label="slash commands"
      >
        <button
          v-for="(item, i) in menuItems"
          :key="item.name"
          type="button"
          class="slash-item"
          :class="{ active: i === menuIndex }"
          role="option"
          :aria-selected="i === menuIndex"
          @mousedown.prevent
          @click="runCommand(item)"
          @mousemove="menuIndex = i"
        >
          <span class="slash-name">/{{ item.name }}</span>
          <span class="slash-desc">{{ item.description }}</span>
        </button>
        <div class="slash-hint">↑/↓ move · tab/enter run · esc dismiss</div>
      </div>
      <div class="composer-shell">
        <textarea
          ref="input"
          v-model="intent"
          class="composer-text"
          rows="1"
          autocomplete="off"
          spellcheck="false"
          aria-label="intent"
          placeholder="Describe what you want Tau to do… (paste or drop an image to attach)"
          :disabled="planning"
          @keydown="onKeydown"
          @paste="onPaste"
        />

        <!-- attachment drafts + validation errors (issue #135) -->
        <div v-if="chipItems.length > 0 || attachError" class="attach-zone">
          <AttachmentChips :items="chipItems" removable @remove="removeAttachment" />
          <div v-if="attachError" class="attach-error" role="alert">{{ attachError }}</div>
        </div>

        <div class="composer-toolbar">
          <div class="toolbar-left">
            <input
              ref="fileInput"
              type="file"
              class="attach-input"
              :accept="FILE_ACCEPT_ATTR"
              multiple
              aria-label="attach images"
              @change="onFilesPicked"
            />
            <button
              type="button"
              class="attach-btn"
              :class="{ active: attachments.length > 0 }"
              :disabled="planning"
              :title="`attach images (PNG/JPEG/WebP/GIF, up to ${MAX_ATTACHMENTS}, max 4 MB each)`"
              aria-label="attach images"
              @click="pickFiles"
            >
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                  d="M13.2 7.3l-4.7 4.7a3.3 3.3 0 01-4.7-4.7l5.2-5.2a2.2 2.2 0 013.1 3.1L7 9.4a1.1 1.1 0 01-1.6-1.6l4-4"
                  stroke="currentColor"
                  stroke-width="1.3"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
            <div class="mode-switch" role="tablist" aria-label="composer mode">
              <button
                type="button"
                class="mode-btn"
                :class="{ active: !props.agentMode }"
                :aria-pressed="!props.agentMode"
                title="single round: plan → review → Run plan"
                @click="emit('mode', false)"
              >
                plan
              </button>
              <button
                type="button"
                class="mode-btn"
                :class="{ active: props.agentMode === true }"
                :aria-pressed="props.agentMode === true"
                title="multi-round goal loop with per-round approval"
                @click="emit('mode', true)"
              >
                agent
              </button>
            </div>
            <span class="hint-sep">·</span>
            <span class="hint">
              <kbd class="tau-kbd">⌘K</kbd>
              <span class="hint-text">focus</span>
            </span>
            <span class="hint-sep">·</span>
            <span class="hint">
              <kbd class="tau-kbd">/</kbd>
              <span class="hint-text">commands</span>
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
  position: relative;
}

/* ---- slash command menu (floats above the beam) ---- */

.slash-menu {
  position: absolute;
  bottom: calc(100% + 10px);
  left: 0;
  right: 0;
  z-index: 20;
  border-radius: 10px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  box-shadow: var(--tau-elev-3);
}

.slash-item {
  display: flex;
  align-items: baseline;
  gap: 10px;
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: 7px;
  padding: 7px 10px;
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 12.5px;
  color: var(--tau-text);
  transition: background var(--t-fast) var(--ease);
}

.slash-item.active {
  background: var(--tau-raised);
}

.slash-name {
  color: var(--tau-info);
  flex: none;
}

.slash-item.active .slash-name {
  font-weight: 700;
}

.slash-desc {
  font-family: var(--font-sans);
  font-size: 12px;
  color: var(--tau-muted);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.slash-hint {
  padding: 5px 10px 3px;
  border-top: 1px solid var(--tau-line);
  margin-top: 3px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--tau-faint);
  user-select: none;
}

@media (prefers-reduced-motion: reduce) {
  .slash-item {
    transition: none;
  }
}

/* ---- image attachments (issue #135) ---- */

.attach-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.attach-btn {
  flex: none;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--tau-faint);
  cursor: pointer;
  padding: 0;
  transition:
    color var(--t-fast) var(--ease),
    border-color var(--t-fast) var(--ease),
    background var(--t-fast) var(--ease);
}

.attach-btn:hover:not(:disabled) {
  color: var(--tau-muted);
  border-color: var(--tau-line);
}

.attach-btn.active {
  color: var(--tau-info);
}

.attach-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.attach-zone {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 0 14px 6px;
}

.attach-error {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--tau-warn, #b58900);
}

.composer-beam.dragging .composer-shell {
  outline: 1.5px dashed var(--tau-info);
  outline-offset: -4px;
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

.mode-switch {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--tau-line-strong); /* tau.line-strong */
  border-radius: 7px;
  overflow: hidden;
}

.mode-btn {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.3px;
  color: var(--tau-faint); /* tau.faint */
  background: transparent;
  border: 0;
  padding: 3px 8px;
  cursor: pointer;
  transition:
    color var(--t-fast) var(--ease),
    background var(--t-fast) var(--ease);
}

.mode-btn + .mode-btn {
  border-left: 1px solid var(--tau-line); /* tau.line */
}

.mode-btn:hover {
  color: var(--tau-muted); /* tau.muted */
}

.mode-btn.active {
  color: var(--tau-bg); /* tau.bg — on chrome */
  background: var(--tau-chrome-3);
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
