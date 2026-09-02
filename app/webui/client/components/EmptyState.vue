<script setup lang="ts">
/**
 * EmptyState — what this surface is and where the gate sits. The serif
 * headline is the editorial flourish (the only place serif appears); it
 * signals "this is a fresh surface" without an illustration. The contract
 * prose mentions Run plan and Alt+N so the "nothing runs until you say so"
 * promise is visible before the first intent.
 */
</script>

<template>
  <div class="empty-state">
    <h1 class="empty-headline">What can Tau do for you?</h1>
    <p class="empty-body">
      Describe what you want in natural language. Tau plans it with the active provider, the
      deterministic safety review runs first, and execution only happens after you press
      <kbd class="tau-kbd">Run plan</kbd>. Conversations persist locally —
      <kbd class="tau-kbd">Alt+N</kbd> starts a new one.
    </p>
    <p class="empty-pipeline">
      intent → plan → review → <span class="pipeline-decide">you decide</span> → result
    </p>
    <p class="empty-hint">
      <kbd class="tau-kbd">⌘K</kbd> focus · <kbd class="tau-kbd">?</kbd> shortcuts ·
      <kbd class="tau-kbd">Alt+S</kbd> reference rail
    </p>
  </div>
</template>

<style scoped>
.empty-state {
  text-align: center;
  padding: 48px 16px 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  animation: tau-enter var(--t-med) var(--ease) both;
}

.empty-headline {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 28px;
  font-weight: 400;
  line-height: 1.25;
  letter-spacing: -0.5px;
  color: var(--tau-text); /* tau.text */
  max-width: 560px;
}

@media (max-width: 640px) {
  .empty-headline {
    font-size: 22px;
  }
  .empty-state {
    padding: 32px 12px 24px;
  }
}

.empty-body {
  margin: 4px 0 0;
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.6;
  color: var(--tau-muted); /* tau.muted */
  max-width: 480px;
}

.empty-pipeline {
  margin: 8px 0 0;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--tau-faint); /* tau.faint */
  letter-spacing: 0.02em;
}

.pipeline-decide {
  color: var(--tau-ok); /* tau.ok */
}

.empty-hint {
  margin: 8px 0 0;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--tau-faint); /* tau.faint */
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px 8px;
  align-items: center;
}
</style>
