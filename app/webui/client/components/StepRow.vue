<script setup lang="ts">
/**
 * StepRow — one plan step on a shared rail. Tool steps and shell steps read
 * differently at a glance (the reviewer treats them differently too: shell
 * always draws stricter scrutiny): tool = name + k="v" args, shell = the raw
 * command. The reason line is the AI's "why", kept visually secondary.
 */
import { computed } from "vue";
import type { PlanStep } from "../lib/api.js";
import { formatArgs } from "../lib/format.js";

const props = defineProps<{ step: PlanStep; index: number }>();

const kindLabel = computed(() => (props.step.kind === "tool" ? "tool" : "shell"));
const argsText = computed(() => (props.step.kind === "tool" ? formatArgs(props.step.args) : ""));
</script>

<template>
  <li class="step-row">
    <span class="step-marker">{{ String(index + 1).padStart(2, "0") }}</span>
    <div class="step-body">
      <div class="step-head">
        <span class="kind-tag" :class="step.kind">{{ kindLabel }}</span>
        <code v-if="step.kind === 'tool'" class="step-name">{{ step.tool }}</code>
        <code v-else class="step-name shell-name">$ {{ step.command }}</code>
        <code v-if="argsText" class="step-args">{{ argsText }}</code>
      </div>
      <p v-if="step.reason" class="step-reason">{{ step.reason }}</p>
    </div>
  </li>
</template>

<style scoped>
.step-row {
  display: flex;
  gap: 10px;
  padding: 6px 0;
}

.step-marker {
  font-family: var(--font-mono);
  font-size: 11px;
  color: #5c6776; /* tau.faint */
  line-height: 1.5;
  user-select: none;
  width: 22px;
  flex: none;
  text-align: right;
}

.step-body {
  min-width: 0;
  flex: 1;
}

.step-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
}

.kind-tag {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  line-height: 1.4;
  padding: 0 5px;
  border-radius: 4px;
  border: 1px solid;
  flex: none;
}

.kind-tag.tool {
  color: #6bb3d9; /* tau.info */
  border-color: rgba(107, 179, 217, 0.3);
  background: rgba(107, 179, 217, 0.1);
}

.kind-tag.shell {
  color: #e0a53c; /* tau.warn */
  border-color: rgba(224, 165, 60, 0.3);
  background: rgba(224, 165, 60, 0.1);
}

.step-name {
  font-family: var(--font-mono);
  font-size: 13px;
  color: #e6ebf2; /* tau.text */
  font-weight: 500;
  word-break: break-all;
}

.shell-name {
  color: #e6ebf2; /* tau.text */
}

.step-args {
  font-family: var(--font-mono);
  font-size: 12px;
  color: #9aa5b4; /* tau.muted */
  word-break: break-all;
}

.step-reason {
  margin: 2px 0 0;
  font-family: var(--font-sans);
  font-size: 12px;
  color: #9aa5b4; /* tau.muted */
  line-height: 1.5;
}
</style>
