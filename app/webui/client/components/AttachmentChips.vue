<script setup lang="ts">
/**
 * AttachmentChips — small image chips with preview thumbnails (issue #135).
 * Used under the user bubble (persisted meta, thumbnail degrades to a type
 * label after reload) and in the composer (live drafts with remove).
 * Pure presentation: no file reading, no fetching.
 */
import { describeBytes, type AttachmentMeta } from "../lib/attachments.js";

defineProps<{
  items: AttachmentMeta[];
  /** Composer mode: chips are removable. */
  removable?: boolean;
}>();
const emit = defineEmits<{ remove: [index: number] }>();
</script>

<template>
  <div v-if="items.length > 0" class="attach-chips" role="list" aria-label="attached images">
    <div v-for="(item, i) in items" :key="i" class="attach-chip" role="listitem">
      <img
        v-if="item.thumb"
        class="attach-thumb"
        :src="item.thumb"
        :alt="item.name || 'attached image'"
        loading="lazy"
      />
      <span v-else class="attach-thumb attach-thumb-fallback" aria-hidden="true">
        {{ item.mediaType.replace("image/", "").toUpperCase() }}
      </span>
      <span class="attach-label">
        <span class="attach-name">{{ item.name || "image" }}</span>
        <span class="attach-size">{{ describeBytes(item.bytes) }}</span>
      </span>
      <button
        v-if="removable"
        type="button"
        class="attach-remove"
        :aria-label="`remove ${item.name || 'image'}`"
        title="remove"
        @click="emit('remove', i)"
      >
        ×
      </button>
    </div>
  </div>
</template>

<style scoped>
.attach-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
}

.attach-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 180px;
  padding: 3px 6px 3px 3px;
  border: 1px solid var(--tau-line);
  border-radius: 7px;
  background: var(--tau-raised);
}

.attach-thumb {
  width: 26px;
  height: 26px;
  border-radius: 5px;
  object-fit: cover;
  flex: none;
  background: var(--tau-panel);
}

.attach-thumb-fallback {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-mono);
  font-size: 7.5px;
  letter-spacing: 0.4px;
  color: var(--tau-muted);
}

.attach-label {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.25;
}

.attach-name {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--tau-text);
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attach-size {
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--tau-faint);
}

.attach-remove {
  flex: none;
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--tau-faint);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition:
    color var(--t-fast) var(--ease),
    background var(--t-fast) var(--ease);
}

.attach-remove:hover {
  color: var(--tau-text);
  background: var(--tau-line);
}

@media (prefers-reduced-motion: reduce) {
  .attach-remove {
    transition: none;
  }
}
</style>
