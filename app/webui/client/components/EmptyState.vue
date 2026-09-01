<script setup lang="ts">
/**
 * EmptyState — what this surface is and where the gate sits. Text only; no
 * illustration, no icon theatre. The keycap marks the exact control that
 * triggers execution so the "nothing runs until you say so" contract is
 * visible before the first intent.
 */
</script>

<template>
  <div class="tau-card border-dashed border-tau-line-strong text-tau-muted">
    <p class="m-0">
      Describe what you want in natural language. Tau plans it with the active provider, the
      deterministic safety review runs first, and execution only happens after you press
      <kbd class="tau-kbd">Run plan</kbd>. Conversations persist locally —
      <kbd class="tau-kbd">Alt+N</kbd> starts a new one.
    </p>
    <p class="mt-2 mb-0 font-mono text-[12px] text-tau-faint">
      intent → plan → review → <span class="text-tau-ok">you decide</span> → result
    </p>
  </div>
</template>
