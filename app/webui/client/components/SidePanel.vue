<script setup lang="ts">
/**
 * SidePanel — the reference rail: Skills (what the AI can load), History
 * (what actually ran), Tools (the tool layer itself: every registered tool,
 * its intrinsic risk, its parameter spec). Equal-width tabs keep the
 * indicator a pure CSS transform (no measuring), which survives resize.
 */
import { computed, ref } from "vue";
import { useSession } from "../composables/session.js";
import { absTime, groupTools, relTime } from "../lib/format.js";
import RiskBadge from "./RiskBadge.vue";

const TABS = ["skills", "history", "tools"] as const;
type Tab = (typeof TABS)[number];

const TAB_TITLES: Record<Tab, string> = {
  skills: "Skills",
  history: "History",
  tools: "Tools",
};

const tab = ref<Tab>("skills");
const tabIndex = computed(() => TABS.indexOf(tab.value));

const { skills, tools, history, settled, refreshTools } = useSession();

const toolGroups = computed(() => groupTools(tools.value));

function select(next: Tab): void {
  tab.value = next;
  if (next === "tools" && tools.value.length === 0) void refreshTools();
}
</script>

<template>
  <aside class="flex flex-col min-h-0 tau-panel overflow-hidden">
    <nav
      class="relative flex border-b border-tau-line flex-none"
      role="tablist"
      aria-label="reference panels"
    >
      <button
        v-for="(t, i) in TABS"
        :key="t"
        role="tab"
        :aria-selected="tab === t"
        :tabindex="tab === t ? 0 : -1"
        class="tab-btn flex-1 py-2 px-2 bg-transparent border-0 cursor-pointer font-ui text-[12px] transition-colors duration-120 ease-out"
        :class="tab === t ? 'text-tau-text' : 'text-tau-faint hover:text-tau-muted'"
        @click="select(t)"
        @keydown.arrow-right.prevent="select(TABS[(i + 1) % TABS.length])"
        @keydown.arrow-left.prevent="select(TABS[(i + 2) % TABS.length])"
      >
        {{ TAB_TITLES[t] }}
      </button>
      <span
        class="tab-indicator absolute bottom-0 h-px bg-tau-ok transition-transform duration-180"
        :style="{
          width: `calc(100% / ${TABS.length})`,
          transform: `translateX(${tabIndex * 100}%)`,
        }"
        aria-hidden="true"
      />
    </nav>

    <div class="overflow-y-auto px-3 py-2.5 flex-1 min-h-0">
      <!-- Skills -->
      <template v-if="tab === 'skills'">
        <p v-if="settled.skills && skills.length === 0" class="panel-empty">
          no skills loaded — <code class="panel-code">tau skill list</code> in the CLI
        </p>
        <div
          v-for="skill in skills"
          :key="skill.name"
          class="py-1.5 border-b border-tau-line last:border-b-0"
        >
          <div class="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <b class="font-mono text-[12px] text-tau-text font-semibold">{{ skill.name }}</b>
            <RiskBadge :level="skill.risk" />
            <span class="font-mono text-[10px] text-tau-faint">{{ skill.origin }}</span>
          </div>
          <p class="m-0 text-[12px] text-tau-muted leading-5">{{ skill.description }}</p>
        </div>
      </template>

      <!-- History -->
      <template v-else-if="tab === 'history'">
        <p v-if="settled.history && history.length === 0" class="panel-empty">
          history is empty — executions land here
        </p>
        <div
          v-for="entry in history"
          :key="entry.id"
          class="py-1.5 border-b border-tau-line last:border-b-0"
        >
          <div class="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <RiskBadge :level="entry.status" :label="entry.status" />
            <span class="font-mono text-[10px] text-tau-faint">{{ entry.kind }}</span>
            <span class="font-mono text-[10px] text-tau-faint" :title="absTime(entry.ts)">
              {{ relTime(entry.ts) }}
            </span>
          </div>
          <p class="m-0 text-[12px] text-tau-muted leading-5 truncate" :title="entry.input">
            {{ entry.input }}
          </p>
        </div>
      </template>

      <!-- Tools -->
      <template v-else>
        <p v-if="settled.tools && tools.length === 0" class="panel-empty">no tools registered</p>
        <section v-for="group in toolGroups" :key="group.family" class="mb-2.5">
          <h3
            class="m-0 mb-1 font-mono text-[10px] uppercase tracking-1px text-tau-faint font-normal"
          >
            {{ group.family }}
          </h3>
          <div
            v-for="tool in group.tools"
            :key="tool.name"
            class="py-1 border-b border-tau-line last:border-b-0"
          >
            <div class="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
              <b class="font-mono text-[12px] text-tau-text font-semibold">{{ tool.name }}</b>
              <RiskBadge :level="tool.risk" />
              <span
                v-if="tool.owner !== 'core'"
                class="font-mono text-[10px] text-tau-faint"
                :title="`owner: ${tool.owner}`"
                >{{ tool.owner }}</span
              >
            </div>
            <p class="m-0 text-[12px] text-tau-muted leading-5">{{ tool.description }}</p>
            <p v-if="tool.params.length" class="m-0 mt-0.5 flex flex-wrap gap-1">
              <span
                v-for="param in tool.params"
                :key="param.name"
                class="param-chip"
                :title="`${param.name}: ${param.type} — ${param.description}`"
              >
                {{ param.name }}<span v-if="param.required" class="text-tau-warn">*</span>
                <span class="param-type">{{ param.type }}</span>
              </span>
            </p>
          </div>
        </section>
        <p class="m-0 font-mono text-[10px] text-tau-faint">
          <span class="text-tau-warn">*</span> required · risk is intrinsic to the tool
        </p>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.tab-btn:focus-visible {
  outline-offset: -2px;
}

.tab-indicator {
  left: 0;
  will-change: transform;
}

.panel-empty {
  margin: 0;
  font-size: 12px;
  color: #5c6878; /* tau.text2 */
}

.panel-code {
  font-family: var(--font-mono);
  font-size: 11px;
  color: #93a0af; /* tau.text1 */
}

.param-chip {
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1.6;
  color: #93a0af; /* tau.text1 */
  border: 1px solid #1e2530; /* tau.line0 */
  background: #151b24; /* tau.bg2 */
  border-radius: 3px;
  padding: 0 4px;
}

.param-type {
  color: #5c6878; /* tau.text2 */
  margin-left: 3px;
}
</style>
