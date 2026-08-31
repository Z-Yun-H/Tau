<script setup lang="ts">
/**
 * Tau WebUI — Vue 3 single-file root component.
 * Same flows as the original vanilla frontend: status chips, the intent →
 * plan → review → confirm → result chat column, and the Skills/History
 * side tabs. Execution stays gated: deny verdicts disable Run, high-risk
 * plans demand the explicit "high risk — run it" checkbox.
 */
import { computed, onMounted, ref } from "vue";

interface ReviewIssue {
  level: string;
  message: string;
}
interface Review {
  verdict: string;
  overallRisk: string;
  issues: ReviewIssue[];
}
interface PlanStep {
  kind: "tool" | "shell";
  tool?: string;
  command?: string;
  args?: Record<string, unknown>;
  reason?: string;
}
interface Plan {
  explanation: string;
  steps: PlanStep[];
}
interface PlanCard {
  type: "plan";
  intent: string;
  plan: Plan;
  review: Review;
  provider: string;
  providerLabel: string;
  warnings: string[];
  running: boolean;
}
interface ResultCard {
  type: "result";
  status: string;
  output: string;
}
interface ErrorCard {
  type: "error";
  intent: string;
  message: string;
}
interface SkillSummary {
  name: string;
  description: string;
  commands: number;
  risk: string;
  origin: string;
}
interface HistoryEntry {
  status: string;
  kind: string;
  input: string;
}
type Card = PlanCard | ResultCard | ErrorCard;

const statusChip = ref("loading…");
const homeChip = ref("");
const skills = ref<SkillSummary[]>([]);
const history = ref<HistoryEntry[]>([]);
const tab = ref<"skills" | "history">("skills");
const intent = ref("");
const cards = ref<Card[]>([]);
const messagesEl = ref<HTMLElement | null>(null);

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, options);
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? res.statusText);
  return body;
}

async function loadStatus(): Promise<void> {
  try {
    const status = await api<{
      provider: { name: string; source: string };
      skills: number;
      tauHome: string;
    }>("/api/status");
    statusChip.value = `provider: ${status.provider.name} (${status.provider.source}) · skills: ${status.skills}`;
    homeChip.value = status.tauHome;
  } catch (error) {
    statusChip.value = `status failed: ${(error as Error).message}`;
  }
}

async function loadSkills(): Promise<void> {
  try {
    skills.value = await api<SkillSummary[]>("/api/skills");
  } catch {
    skills.value = [];
  }
}

async function loadHistory(): Promise<void> {
  try {
    history.value = await api<HistoryEntry[]>("/api/history");
  } catch {
    history.value = [];
  }
}

function scrollToEnd(): void {
  requestAnimationFrame(() => {
    messagesEl.value?.scrollTo({ top: messagesEl.value.scrollHeight, behavior: "smooth" });
  });
}

const noteVisible = computed(() => cards.value.length === 0);

onMounted(() => {
  void loadStatus();
  void loadSkills();
  void loadHistory();
});

async function submitIntent(): Promise<void> {
  const text = intent.value.trim();
  if (!text) return;
  intent.value = "";
  try {
    const data = await api<{
      intent: string;
      plan: Plan;
      review: Review;
      provider: string;
      providerLabel: string;
      warnings: string[];
    }>("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: text }),
    });
    cards.value.push({
      type: "plan",
      intent: data.intent,
      plan: data.plan,
      review: data.review ?? { verdict: "allow", overallRisk: "low", issues: [] },
      provider: data.provider,
      providerLabel: data.providerLabel,
      warnings: data.warnings ?? [],
      running: false,
    });
  } catch (error) {
    cards.value.push({ type: "error", intent: text, message: (error as Error).message });
  }
  scrollToEnd();
}

async function runPlan(card: PlanCard): Promise<void> {
  const checkbox = document.querySelector<HTMLInputElement>("#confirm-high-risk");
  card.running = true;
  try {
    const result = await api<{
      status: string;
      output: string;
      outcomes: { ok: boolean; skipped: boolean }[];
    }>("/api/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        intent: card.intent,
        plan: card.plan,
        provider: card.provider,
        confirmHighRisk: checkbox?.checked === true,
      }),
    });
    const outcomeLines = (result.outcomes ?? [])
      .map((o, i) => `${i + 1}. [${o.skipped ? "skipped" : o.ok ? "ok" : "failed"}]`)
      .join("\n");
    cards.value.push({
      type: "result",
      status: result.status,
      output: `${outcomeLines}\n\n${result.output || "(no output)"}`,
    });
    cards.value = cards.value.filter((c) => c !== card);
  } catch (error) {
    cards.value.push({ type: "error", intent: card.intent, message: (error as Error).message });
    cards.value = cards.value.filter((c) => c !== card);
  } finally {
    card.running = false;
    void loadHistory();
    scrollToEnd();
  }
}

function discard(card: Card): void {
  cards.value = cards.value.filter((c) => c !== card);
}

function badgeClass(level: string): string {
  if (level === "medium" || level === "warn") return "text-tau-warn";
  if (level === "high" || level === "blocked") return "text-tau-danger";
  return "text-tau-brand"; // low / ok
}
</script>

<template>
  <header class="flex items-center gap-2.5 px-4 py-2.5 border-b border-tau-border bg-tau-panel">
    <span class="text-[15px]">τ <b class="text-tau-brand">tau web</b></span>
    <span class="tau-chip">{{ statusChip }}</span>
    <span class="flex-1" />
    <span class="tau-chip">{{ homeChip }}</span>
  </header>

  <main class="flex-1 grid grid-cols-[1fr_300px] gap-3 px-4 py-3 min-h-0">
    <section class="flex flex-col min-h-0">
      <div ref="messagesEl" class="flex-1 overflow-y-auto pr-1.5">
        <div
          v-if="noteVisible"
          class="note text-tau-muted border border-dashed border-tau-border rounded-lg px-3 py-2.5"
        >
          Type a natural-language intent. Tau proposes a plan, the safety review runs first —
          execution only happens after you press <b>Run plan</b>.
        </div>

        <div v-for="(card, i) in cards" :key="i" class="tau-card">
          <!-- plan card -->
          <template v-if="card.type === 'plan'">
            <div class="text-tau-brand mb-1.5">
              plan for “{{ card.intent }}”
              <span class="tau-badge" :class="badgeClass(card.review.overallRisk)">{{
                card.review.overallRisk
              }}</span>
              <span class="text-tau-muted text-xs">
                via {{ card.providerLabel || card.provider }}</span
              >
            </div>
            <div v-for="(step, s) in card.plan.steps ?? []" :key="s" class="flex gap-2 py-0.5">
              <span class="text-tau-muted min-w-5">{{ s + 1 }}.</span>
              <span class="break-all">
                <template v-if="step.kind === 'tool'"
                  >tool <b>{{ step.tool }}</b> {{ JSON.stringify(step.args ?? {}) }}</template
                >
                <template v-else
                  >shell <b>$ {{ step.command }}</b></template
                >
                <div v-if="step.reason" class="text-tau-muted text-xs">{{ step.reason }}</div>
              </span>
            </div>
            <div
              v-for="(issue, ii) in card.review.issues ?? []"
              :key="ii"
              class="text-xs py-0.5"
              :class="issue.level === 'blocked' ? 'text-tau-danger' : 'text-tau-warn'"
            >
              {{ issue.level === "blocked" ? "BLOCKED" : "CAUTION" }} {{ issue.message }}
            </div>
            <div
              v-for="(warning, wi) in card.warnings"
              :key="'w' + wi"
              class="text-tau-warn text-xs py-0.5"
            >
              plugin: {{ warning }}
            </div>
            <div class="flex gap-2 mt-2.5 items-center">
              <button
                class="tau-btn"
                :disabled="card.review.verdict === 'deny' || card.running"
                @click="runPlan(card)"
              >
                {{ card.running ? "Running…" : "Run plan" }}
              </button>
              <button
                class="tau-btn hover:border-tau-danger hover:text-tau-danger"
                @click="discard(card)"
              >
                Discard
              </button>
              <label
                v-if="card.review.overallRisk === 'high' && card.review.verdict !== 'deny'"
                class="flex gap-1.5 items-center text-tau-warn text-xs"
              >
                <input id="confirm-high-risk" type="checkbox" /> high risk — run it
              </label>
            </div>
          </template>

          <!-- result card -->
          <template v-else-if="card.type === 'result'">
            <div class="text-tau-brand mb-1.5">
              result
              <span
                class="tau-badge"
                :class="badgeClass(card.status === 'ok' ? 'ok' : 'blocked')"
                >{{ card.status }}</span
              >
            </div>
            <pre
              class="out bg-tau-bg border border-tau-border rounded-lg p-2.5 overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap break-words"
              >{{ card.output }}</pre>
          </template>

          <!-- error card -->
          <template v-else>
            <div class="text-tau-brand mb-1.5">“{{ card.intent }}”</div>
            <div class="text-tau-danger text-xs py-0.5">{{ card.message }}</div>
            <div class="text-tau-muted text-xs mt-1">
              configure a key with `tau provider set-key`, or use `tau config set provider mock`.
            </div>
          </template>
        </div>
      </div>

      <form class="flex gap-2 pt-2.5" @submit.prevent="submitIntent">
        <input
          v-model="intent"
          class="tau-input"
          type="text"
          autocomplete="off"
          placeholder="e.g. list ts files under src — 自然语言也可以"
        />
        <button type="submit" class="tau-btn">Plan</button>
      </form>
    </section>

    <aside class="flex flex-col border border-tau-border rounded-10px bg-tau-panel min-h-0">
      <nav class="flex border-b border-tau-border">
        <button
          class="flex-1 border-0 rounded-none bg-transparent text-tau-muted py-2.5 cursor-pointer font-inherit"
          :class="tab === 'skills' ? 'text-tau-brand' : ''"
          @click="tab = 'skills'"
        >
          Skills
        </button>
        <button
          class="flex-1 border-0 rounded-none bg-transparent text-tau-muted py-2.5 cursor-pointer font-inherit"
          :class="tab === 'history' ? 'text-tau-brand' : ''"
          @click="tab = 'history'"
        >
          History
        </button>
      </nav>
      <div class="overflow-y-auto px-3 py-2.5 flex-1">
        <template v-if="tab === 'skills'">
          <div v-if="skills.length === 0" class="text-tau-muted text-xs">no skills loaded</div>
          <div v-for="skill in skills" :key="skill.name" class="py-1.5 border-b border-tau-border">
            <b class="text-tau-brand">{{ skill.name }}</b>
            <span class="tau-badge" :class="badgeClass(skill.risk)">{{ skill.risk }}</span>
            <span class="tau-badge" :class="badgeClass('low')">{{ skill.origin }}</span>
            <div class="text-tau-muted text-xs">{{ skill.description }}</div>
          </div>
        </template>
        <template v-else>
          <div v-if="history.length === 0" class="text-tau-muted text-xs">history is empty</div>
          <div
            v-for="(entry, hi) in history"
            :key="hi"
            class="py-1 border-b border-tau-border text-xs"
          >
            <span :class="entry.status === 'ok' ? 'text-tau-brand' : 'text-tau-danger'">{{
              entry.status
            }}</span>
            <span class="text-tau-muted"> [{{ entry.kind }}] </span>{{ entry.input }}
          </div>
        </template>
      </div>
    </aside>
  </main>
</template>
