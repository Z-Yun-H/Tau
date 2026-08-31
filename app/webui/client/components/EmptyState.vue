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
      <kbd class="tau-kbd">Run plan</kbd>.
    </p>
    <p class="mt-2 mb-0 font-mono text-[12px] text-tau-faint">
      intent → plan → review → <span class="text-tau-ok">you decide</span> → result
    </p>
  </div>
</template>

<style scoped>
.tau-kbd {
  font-family: var(--font-mono);
  font-size: 11px;
  color: #5ec97a; /* tau.ok — keep in sync with uno.config.ts */
  border: 1px solid #2a3342;
  border-bottom-width: 2px;
  border-radius: 4px;
  padding: 0 5px;
  background: #151b24;
}
</style>
