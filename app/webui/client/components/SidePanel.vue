<script setup lang="ts">
/**
 * SidePanel — the reference rail: Skills (what the AI can load), History
 * (what actually ran), Tools (the tool layer itself: every registered tool,
 * its intrinsic risk, its parameter spec). Equal-width tabs keep the
 * indicator a pure CSS transform (no measuring), which survives resize.
 *
 * Tab styling is refined: the active tab gets the tau.ok accent text + a
 * brighter indicator; inactive tabs are tau.faint, hover tau.muted. The
 * sliding indicator stays as a pure-CSS translateX (preserved contract).
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
  <aside class="side-panel tau-panel flex flex-col min-h-0 overflow-hidden">
    <nav
      class="tab-nav relative flex border-b border-tau-line flex-none"
      role="tablist"
      aria-label="reference panels"
    >
      <button
        v-for="(t, i) in TABS"
        :key="t"
        role="tab"
        :aria-selected="tab === t"
        :tabindex="tab === t ? 0 : -1"
        class="tab-btn"
        :class="tab === t ? 'on' : ''"
        @click="select(t)"
        @keydown.arrow-right.prevent="select(TABS[(i + 1) % TABS.length])"
        @keydown.arrow-left.prevent="select(TABS[(i + 2) % TABS.length])"
      >
        {{ TAB_TITLES[t] }}
      </button>
      <span
        class="tab-indicator"
        :style="{
          width: `calc(100% / ${TABS.length})`,
          transform: `translateX(${tabIndex * 100}%)`,
        }"
        aria-hidden="true"
      />
    </nav>

    <div class="tab-body overflow-y-auto flex-1 min-h-0">
      <!-- Skills -->
      <template v-if="tab === 'skills'">
        <p v-if="settled.skills && skills.length === 0" class="panel-empty">
          no skills loaded — <code class="panel-code">tau skill list</code> in the CLI
        </p>
        <div v-for="skill in skills" :key="skill.name" class="entry">
          <div class="entry-head">
            <b class="entry-name">{{ skill.name }}</b>
            <RiskBadge :level="skill.risk" />
            <span class="entry-meta">{{ skill.origin }}</span>
          </div>
          <p class="entry-desc">{{ skill.description }}</p>
        </div>
      </template>

      <!-- History -->
      <template v-else-if="tab === 'history'">
        <p v-if="settled.history && history.length === 0" class="panel-empty">
          history is empty — executions land here
        </p>
        <div v-for="entry in history" :key="entry.id" class="entry">
          <div class="entry-head">
            <RiskBadge :level="entry.status" :label="entry.status" />
            <span class="entry-meta">{{ entry.kind }}</span>
            <span class="entry-meta" :title="absTime(entry.ts)">{{ relTime(entry.ts) }}</span>
          </div>
          <p class="entry-desc truncate" :title="entry.input">{{ entry.input }}</p>
        </div>
      </template>

      <!-- Tools -->
      <template v-else>
        <p v-if="settled.tools && tools.length === 0" class="panel-empty">no tools registered</p>
        <section v-for="group in toolGroups" :key="group.family" class="tool-group">
          <h3 class="tool-group-head">{{ group.family }}</h3>
          <div v-for="tool in group.tools" :key="tool.name" class="entry">
            <div class="entry-head">
              <b class="entry-name">{{ tool.name }}</b>
              <RiskBadge :level="tool.risk" />
              <span
                v-if="tool.owner !== 'core'"
                class="entry-meta"
                :title="`owner: ${tool.owner}`"
                >{{ tool.owner }}</span
              >
            </div>
            <p class="entry-desc">{{ tool.description }}</p>
            <p v-if="tool.params.length" class="param-list">
              <span
                v-for="param in tool.params"
                :key="param.name"
                class="param-chip"
                :title="`${param.name}: ${param.type} — ${param.description}`"
              >
                {{ param.name }}<span v-if="param.required" class="req">*</span>
                <span class="param-type">{{ param.type }}</span>
              </span>
            </p>
          </div>
        </section>
        <p class="panel-footer">
          <span class="req">*</span> required · risk is intrinsic to the tool
        </p>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.tab-btn {
  flex: 1;
  padding: 10px 8px;
  background: transparent;
  border: 0;
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: 12px;
  color: #5c6776; /* tau.faint */
  transition: color var(--t-fast) var(--ease);
}

.tab-btn:hover {
  color: #9aa5b4; /* tau.muted */
}

.tab-btn.on {
  color: #e6ebf2; /* tau.text */
  font-weight: 500;
}

.tab-btn:focus-visible {
  outline-offset: -2px;
}

.tab-indicator {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 2px;
  background: #5ec97a; /* tau.ok */
  transition: transform var(--t-med) var(--ease);
  will-change: transform;
}

.tab-body {
  padding: 10px 12px;
}

.panel-empty {
  margin: 0;
  font-size: 12px;
  color: #5c6776; /* tau.faint */
}

.panel-code {
  font-family: var(--font-mono);
  font-size: 11px;
  color: #9aa5b4; /* tau.muted */
}

.entry {
  padding: 8px 0;
  border-bottom: 1px solid #1b2230; /* tau.line */
}

.entry:last-child {
  border-bottom: 0;
}

.entry-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 6px;
}

.entry-name {
  font-family: var(--font-mono);
  font-size: 12px;
  color: #e6ebf2; /* tau.text */
  font-weight: 600;
}

.entry-meta {
  font-family: var(--font-mono);
  font-size: 10px;
  color: #5c6776; /* tau.faint */
}

.entry-desc {
  margin: 2px 0 0;
  font-family: var(--font-sans);
  font-size: 12px;
  color: #9aa5b4; /* tau.muted */
  line-height: 1.5;
}

.tool-group {
  margin-bottom: 12px;
}

.tool-group-head {
  margin: 0 0 6px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #5c6776; /* tau.faint */
}

.param-list {
  margin: 4px 0 0;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.param-chip {
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1.6;
  color: #9aa5b4; /* tau.muted */
  border: 1px solid #1b2230; /* tau.line */
  background: #141a24; /* tau.raised */
  border-radius: 4px;
  padding: 0 5px;
}

.req {
  color: #e0a53c; /* tau.warn */
}

.param-type {
  color: #5c6776; /* tau.faint */
  margin-left: 3px;
}

.panel-footer {
  margin: 12px 0 0;
  font-family: var(--font-mono);
  font-size: 10px;
  color: #5c6776; /* tau.faint */
}
</style>
