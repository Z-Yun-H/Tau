<script setup lang="ts">
/**
 * RiskBadge — the ONE semantic atom. Every risk/verdict/status indicator in
 * the UI goes through this mapping so the color language stays consistent:
 * low/ok → green, medium/warn → amber, high/failed → red, blocked → dim gray,
 * review → info blue (in-flight, not a verdict).
 *
 * Color tokens are owned here — never duplicate them inline. See DESIGN.md
 * §3 "Semantic system — risk".
 */
import { computed } from "vue";

const props = defineProps<{ level: string; label?: string }>();

const STYLES: Record<string, string> = {
  ok: "text-tau-ok border-tau-ok-edge bg-tau-ok-soft",
  low: "text-tau-ok border-tau-ok-edge bg-tau-ok-soft",
  warn: "text-tau-warn border-tau-warn-edge bg-tau-warn-soft",
  medium: "text-tau-warn border-tau-warn-edge bg-tau-warn-soft",
  danger: "text-tau-danger border-tau-danger-edge bg-tau-danger-soft",
  high: "text-tau-danger border-tau-danger-edge bg-tau-danger-soft",
  failed: "text-tau-danger border-tau-danger-edge bg-tau-danger-soft",
  deny: "text-tau-danger border-tau-danger-edge bg-tau-danger-soft",
  review: "text-tau-info border-tau-info-edge bg-tau-info-soft",
  blocked: "text-tau-blocked border-tau-line-strong bg-tau-raised",
  cancelled: "text-tau-blocked border-tau-line-strong bg-tau-raised",
};

const styleClass = computed(() => STYLES[props.level] ?? STYLES.blocked);
const label = computed(() => props.label ?? props.level);
</script>

<template>
  <span class="tau-badge" :class="styleClass">{{ label }}</span>
</template>
