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

// Catalog overview counts — surfaced at the top of the Tools tab so the user
// sees the catalog shape at a glance (main info first). AGENTS/ai-integration.md
// "prefer DRY-RUN modes": the dry-run count tells the user how many tools are
// safe to propose by default.
const readCount = computed(() => tools.value.filter((t) => !t.mutates).length);
const mutCount = computed(() => tools.value.filter((t) => t.mutates).length);
const dryRunCount = computed(() => tools.value.filter((t) => t.dryRunDefault).length);

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
        <template v-else>
          <!-- catalog overview: total + read/mut split, surfaced up top so the
               user can see the catalog shape at a glance (main info first). -->
          <div class="catalog-overview">
            <span class="overview-count">{{ tools.length }} tools</span>
            <span class="overview-sep">·</span>
            <span class="overview-read">{{ readCount }} read</span>
            <span class="overview-sep">·</span>
            <span class="overview-mut">{{ mutCount }} mutates</span>
            <span v-if="dryRunCount > 0" class="overview-sep">·</span>
            <span v-if="dryRunCount > 0" class="overview-dry">{{ dryRunCount }} dry-run</span>
          </div>
          <section v-for="group in toolGroups" :key="group.family" class="tool-group">
            <h3 class="tool-group-head">
              {{ group.family }} <span class="group-count">({{ group.tools.length }})</span>
            </h3>
            <div v-for="tool in group.tools" :key="tool.name" class="entry">
              <div class="entry-head">
                <b class="entry-name">{{ tool.name }}</b>
                <RiskBadge :level="tool.risk" />
                <span v-if="tool.mutates" class="kind-tag mut" title="this tool mutates state"
                  >MUT</span
                >
                <span v-else class="kind-tag read" title="read-only tool">READ</span>
                <span
                  v-if="tool.dryRunDefault"
                  class="kind-tag dry"
                  title="defaults to dry-run preview; pass execute:true to apply"
                  >DRY</span
                >
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
            <span class="req">*</span> required · risk is intrinsic to the tool ·
            <span class="mut-text">MUT</span> mutates · <span class="dry-text">DRY</span> dry-run
            default
          </p>
        </template>
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

.group-count {
  color: #3f4856; /* tau.placeholder — dimmer than the family name */
  margin-left: 2px;
}

/* Catalog overview row — the main-info summary at the top of the Tools tab. */
.catalog-overview {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 6px;
  margin: 0 0 10px;
  padding: 6px 8px;
  border: 1px solid #1b2230; /* tau.line */
  border-radius: 6px;
  background: #141a24; /* tau.raised */
  font-family: var(--font-mono);
  font-size: 11px;
}

.overview-count {
  color: #e6ebf2; /* tau.text */
  font-weight: 600;
}

.overview-sep {
  color: #3f4856; /* tau.placeholder */
}

.overview-read {
  color: #5ec97a; /* tau.ok — read-only is the safe default */
}

.overview-mut {
  color: #e0a53c; /* tau.warn — mutates needs attention */
}

.overview-dry {
  color: #6bb3d9; /* tau.info — dry-run-default is a hint, not a risk */
}

/* Kind tags — MUT / READ / DRY. Same shape as the StepRow kind tags in the
   PlanCard, so the visual language stays consistent across the UI. */
.kind-tag {
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  line-height: 1.4;
  padding: 0 4px;
  border-radius: 3px;
  border: 1px solid;
  flex: none;
}

.kind-tag.read {
  color: #6bb3d9; /* tau.info */
  border-color: rgba(107, 179, 217, 0.3);
  background: rgba(107, 179, 217, 0.1);
}

.kind-tag.mut {
  color: #e0a53c; /* tau.warn */
  border-color: rgba(224, 165, 60, 0.3);
  background: rgba(224, 165, 60, 0.1);
}

.kind-tag.dry {
  color: #5c6776; /* tau.faint */
  border-color: #28303f; /* tau.line-strong */
  background: #141a24; /* tau.raised */
}

.mut-text {
  color: #e0a53c; /* tau.warn */
}

.dry-text {
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
