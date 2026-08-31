<script setup lang="ts">
/**
 * StatusHeader — identity + runtime facts, one line on desktop, wrapping to
 * two rows on narrow screens (tauHome hides first, then the count chips).
 */
import { useSession } from "../composables/session.js";

const { status, statusError } = useSession();
</script>

<template>
  <header
    class="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-2.5 border-b border-tau-line bg-tau-panel"
  >
    <span class="font-mono text-[14px] whitespace-nowrap">
      <span class="text-tau-ok">τ</span>
      <b class="text-tau-text font-semibold"> tau web</b>
    </span>

    <span v-if="status" class="tau-chip" title="active AI provider">
      <span class="text-tau-info">{{ status.provider.name }}</span>
      <span class="text-tau-faint">{{ status.provider.model }}</span>
    </span>
    <span v-else-if="statusError" class="tau-chip text-tau-danger" :title="statusError">
      status unavailable
    </span>
    <span v-else class="tau-chip">…</span>

    <span
      v-if="status"
      class="tau-chip hidden md:inline-flex"
      title="loaded skills · configured MCP plugins"
    >
      <span>skills {{ status.skills }}</span>
      <span class="text-tau-faint">·</span>
      <span>plugins {{ status.plugins }}</span>
    </span>

    <span class="flex-1" />

    <span v-if="status" class="tau-chip" title="tau version">v{{ status.version }}</span>
    <span v-if="status" class="tau-chip hidden sm:inline-flex max-w-40" :title="status.tauHome">
      <span class="truncate">{{ status.tauHome }}</span>
    </span>
  </header>
</template>
