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
  <li class="flex gap-2.5 py-1">
    <span class="step-marker font-mono text-[11px] text-tau-faint leading-5 select-none">
      {{ String(index + 1).padStart(2, "0") }}
    </span>
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span
          class="font-mono text-[10px] uppercase tracking-1px leading-4 px-1 rounded-3px border"
          :class="
            step.kind === 'tool'
              ? 'text-tau-info border-tau-info/40'
              : 'text-tau-warn border-tau-warn/40'
          "
          >{{ kindLabel }}</span
        >
        <code v-if="step.kind === 'tool'" class="font-mono text-[13px] text-tau-text">{{
          step.tool
        }}</code>
        <code v-else class="font-mono text-[13px] text-tau-text">$ {{ step.command }}</code>
        <code v-if="argsText" class="font-mono text-[12px] text-tau-muted break-all">{{
          argsText
        }}</code>
      </div>
      <p v-if="step.reason" class="m-0 mt-0.5 text-[12px] text-tau-muted">{{ step.reason }}</p>
    </div>
  </li>
</template>

<style scoped>
.step-marker {
  width: 20px;
  flex: none;
  text-align: right;
}
</style>
