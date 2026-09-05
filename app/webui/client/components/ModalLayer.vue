<script setup lang="ts">
/**
 * ModalLayer — the overlay switch (issue #151 extraction): renders the
 * shortcuts modal and/or the settings panel per ui-state. App.vue mounts
 * one instance; the keyboard loop, slash commands and the header button
 * open surfaces by flipping the same useUiState() refs.
 */
import { useUiState } from "../composables/ui-state.js";
import SettingsPanel from "./SettingsPanel.vue";
import ShortcutsModal from "./ShortcutsModal.vue";

const { shortcutsOpen, settingsOpen } = useUiState();
</script>

<template>
  <ShortcutsModal v-if="shortcutsOpen" @close="shortcutsOpen = false" />
  <SettingsPanel v-if="settingsOpen" @close="settingsOpen = false" />
</template>
