<script setup lang="ts">
/**
 * ToolCallCard — one structured tool call (v0.5.0, issue #110): which tool,
 * its risk badge, its full args JSON (collapsible), and its live output.
 * Goal rounds render this for tool steps; the AI's actions stop being a
 * one-line label and become an inspectable surface.
 *
 * file.read steps get a dedicated viewer variant instead: the numbered
 * line-numbered tool output is parsed back to raw content and re-rendered
 * through shiki with the language detected from the file name (the SAME
 * detection the tool itself reports — see lib/language.ts, parity-tested
 * against @tau/tools). Highlighting stays progressive: any failure leaves
 * the plain escaped text, which is always a valid final state.
 */
import { computed, ref, watch } from "vue";
import type { PlanStep } from "../lib/api.js";
import { languageForFile } from "../lib/language.js";
import { highlightCode } from "../lib/highlight.js";
import RiskBadge from "./RiskBadge.vue";

const props = defineProps<{
  step: PlanStep;
  /** Live output accumulated from step_output chunks. */
  output: string;
  running?: boolean;
  ok?: boolean;
  skipped?: boolean;
  /** Tool risk from the /api/tools inventory, when known. */
  risk?: string;
}>();

const argsOpen = ref(false);
const argsJson = computed(() =>
  props.step.args && Object.keys(props.step.args).length > 0
    ? JSON.stringify(props.step.args, null, 2)
    : "",
);

// ---- file.read viewer ----

/** Undo readTool's `%4d  text` gutter; a tab after the gutter is content. */
function parseNumberedOutput(raw: string): string {
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const match = /^ *\d+ {2}(.*)$/.exec(line);
      return match?.[1] ?? line;
    })
    .join("\n");
}

const viewer = computed(() => {
  if (props.step.tool !== "file.read") return null;
  const path = typeof props.step.args?.["path"] === "string" ? props.step.args["path"] : "";
  if (!path) return null;
  return {
    path: path as string,
    language: languageForFile(path as string),
    content: parseNumberedOutput(props.output),
  };
});

const viewerHtml = ref<string | null>(null);

watch(
  () => (viewer.value ? `${viewer.value.language}\u0000${viewer.value.content}` : ""),
  async (signature) => {
    if (!signature || !viewer.value) {
      viewerHtml.value = null;
      return;
    }
    const html = await highlightCode(viewer.value.content, viewer.value.language);
    // Race guard: only the newest render wins.
    if (viewer.value && `${viewer.value.language}\u0000${viewer.value.content}` === signature) {
      viewerHtml.value = html;
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="tool-call">
    <div class="call-head">
      <span
        class="call-dot"
        :class="running ? 'dot-run' : skipped ? 'dot-skip' : ok ? 'dot-ok' : 'dot-bad'"
      />
      <code class="call-name">{{ step.tool }}</code>
      <RiskBadge v-if="risk" :level="risk" />
      <span v-if="running" class="call-live">running</span>
      <span v-else-if="skipped" class="call-live skipped">skipped</span>
      <button v-if="argsJson" class="args-toggle" type="button" @click="argsOpen = !argsOpen">
        {{ argsOpen ? "hide args" : "args" }}
      </button>
    </div>

    <!-- file.read: highlighted file viewer -->
    <div v-if="viewer" class="file-viewer">
      <div class="viewer-head">
        <span class="viewer-path">{{ viewer.path }}</span>
        <span class="viewer-lang">{{ viewer.language }}</span>
      </div>
      <!-- eslint-disable-next-line vue/no-v-html — shiki output, escaped-first input -->
      <div v-if="viewerHtml" class="viewer-body" v-html="viewerHtml" />
      <pre v-else-if="viewer.content" class="viewer-plain">{{ viewer.content }}</pre>
      <p v-else class="viewer-empty">no content returned</p>
    </div>

    <!-- every other tool: collapsible args + plain live output -->
    <template v-else>
      <pre v-if="argsOpen && argsJson" class="args-json">{{ argsJson }}</pre>
      <pre v-if="output" class="call-out">{{ output }}</pre>
    </template>
  </div>
</template>

<style scoped>
.tool-call {
  border-left: 2px solid var(--tau-line);
  padding-left: 10px;
  margin: 2px 0;
}

.call-head {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex-wrap: wrap;
}

.call-dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.dot-run {
  background: var(--tau-info);
  animation: tau-pulse 1.1s var(--ease) infinite;
}

.dot-ok {
  background: var(--tau-ok);
}
.dot-skip {
  background: var(--tau-placeholder);
}
.dot-bad {
  background: var(--tau-danger);
}

.call-name {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 500;
  color: var(--tau-text);
  word-break: break-all;
}

.call-live {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--tau-info);
}

.call-live.skipped {
  color: var(--tau-placeholder);
}

.args-toggle {
  margin-left: auto;
  background: none;
  border: 1px solid var(--tau-line-strong);
  border-radius: 6px;
  padding: 1px 7px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--tau-faint);
  cursor: pointer;
}

.args-toggle:hover {
  color: var(--tau-text);
  border-color: var(--tau-faint);
}

.args-json {
  margin: 6px 0 0;
  padding: 6px 8px;
  background: var(--tau-bg);
  border: 1px solid var(--tau-line);
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  color: var(--tau-muted);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 180px;
  overflow: auto;
}

.call-out {
  margin: 6px 0 0;
  padding: 6px 8px;
  background: var(--tau-bg);
  border: 1px solid var(--tau-line);
  border-radius: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  color: var(--tau-muted);
  max-height: 200px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

/* ---- file viewer variant ---- */

.file-viewer {
  margin-top: 6px;
  border: 1px solid var(--tau-line);
  border-radius: 8px;
  overflow: hidden;
}

.viewer-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  background: var(--tau-raised);
  border-bottom: 1px solid var(--tau-line);
}

.viewer-path {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--tau-text);
  word-break: break-all;
}

.viewer-lang {
  margin-left: auto;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--tau-info);
  border: 1px solid var(--tau-info-edge);
  background: var(--tau-info-soft);
  border-radius: 5px;
  padding: 0 6px;
  flex: none;
}

.viewer-body {
  max-height: 320px;
  overflow: auto;
  font-size: 11px;
}

.viewer-body :deep(pre) {
  margin: 0;
  padding: 8px 10px;
}

.viewer-plain {
  margin: 0;
  padding: 8px 10px;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  color: var(--tau-muted);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 320px;
  overflow: auto;
}

.viewer-empty {
  margin: 0;
  padding: 8px 10px;
  font-size: 11px;
  color: var(--tau-faint);
}
</style>
