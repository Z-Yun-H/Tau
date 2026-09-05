<script setup lang="ts">
/**
 * SettingsPanel — the settings surface (Issue #86 unit 4/5; provider
 * setup added by issue #152; model & thinking selection by issue #164).
 * One modal, five sections: provider setup (ProviderSetup.vue), provider
 * (who answers — model select + thinking controls, capability-driven),
 * risk policy (what the gate auto-approves, read-only), appearance
 * (theme), sessions (local thread state).
 *
 * The read sections are a VIEW of `GET /api/config` — the redacted
 * effective config, produced by the same `redactConfig` `tau config list`
 * uses, so keys arrive as "sk-***last4", never plaintext. The write paths
 * are per-provider request knobs: POST /api/config/provider (credentials,
 * issue #152), POST /api/config/model (issue #164) and POST
 * /api/config/thinking (issue #164) — the gate and risk policy never
 * move into the browser. Reuses the ShortcutsModal skeleton (overlay /
 * panel / esc) and the theme singleton from lib/theme.ts.
 */
import { computed, onMounted, ref } from "vue";
import { api, postJson, type ConfigPayload, type ModelCatalogPayload } from "../lib/api.js";
import { relTime } from "../lib/format.js";
import { MAX_THREADS, usePlanFlow } from "../composables/plan-flow.js";
import { useSession } from "../composables/session.js";
import { useTheme, type ThemePreference } from "../lib/theme.js";
import ProviderSetup from "./ProviderSetup.vue";
import RiskBadge from "./RiskBadge.vue";

const emit = defineEmits<{ close: [] }>();

const { preference, setPreference } = useTheme();
const { threads } = usePlanFlow();
const { history } = useSession();

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "system" },
  { value: "light", label: "light" },
  { value: "dark", label: "dark" },
];

const config = ref<ConfigPayload | null>(null);
const loadError = ref("");

const { refreshStatus } = useSession();

async function load(): Promise<void> {
  try {
    config.value = await api<ConfigPayload>("/api/config");
  } catch (error) {
    loadError.value = (error as Error).message;
  }
}

/* ---- model & thinking selection (issue #164) — capability-driven ---- */

const models = ref<ModelCatalogPayload | null>(null);
const modelsLoading = ref(false);
const modelSaving = ref(false);
const selectionError = ref("");

/** Catalog for the ACTIVE provider (mock serves a deterministic one offline). */
async function loadModels(refresh = false): Promise<void> {
  modelsLoading.value = true;
  try {
    models.value = await api<ModelCatalogPayload>(`/api/models${refresh ? "?refresh=1" : ""}`);
    selectionError.value = "";
  } catch (error) {
    selectionError.value = (error as Error).message;
  } finally {
    modelsLoading.value = false;
  }
}

/** The select's bound value: the configured model, else empty = (auto). */
const selectedModel = computed(
  () => models.value?.activeModel ?? (config.value?.provider.model || ""),
);

/** Ids in the catalog — used to keep the current choice selectable. */
const modelIds = computed(() => (models.value?.models ?? []).map((m) => m.id));

async function onModelChange(event: Event): Promise<void> {
  const value = (event.target as HTMLSelectElement).value;
  if (!value || !config.value || modelSaving.value) return;
  modelSaving.value = true;
  selectionError.value = "";
  try {
    const next = await postJson<ConfigPayload>("/api/config/model", {
      provider: config.value.provider.name,
      model: value,
    });
    onSaved(next);
  } catch (error) {
    selectionError.value = (error as Error).message;
  } finally {
    modelSaving.value = false;
  }
}

const thinkingSaving = ref(false);

async function setThinking(patch: {
  mode?: "on" | "off";
  effort?: "low" | "medium" | "high";
}): Promise<void> {
  if (!config.value || thinkingSaving.value) return;
  thinkingSaving.value = true;
  selectionError.value = "";
  try {
    const next = await postJson<ConfigPayload>("/api/config/thinking", {
      provider: config.value.thinking.provider,
      ...patch,
    });
    onSaved(next);
  } catch (error) {
    selectionError.value = (error as Error).message;
  } finally {
    thinkingSaving.value = false;
  }
}

onMounted(() => {
  void load();
  void loadModels();
});

/** After a provider save: re-render from the server's redacted payload
 * and refresh the header chip (the active provider may have changed). */
function onSaved(next: ConfigPayload): void {
  config.value = next;
  void refreshStatus();
}
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-panel tau-surface rounded-12px" role="dialog" aria-label="settings">
      <div class="modal-head">
        <span class="eyebrow-label">settings</span>
        <RiskBadge level="low" label="request knobs writable · gate read-only" />
        <span class="flex-1" />
        <button class="tau-btn !px-2.5 !py-1 text-[11px]" @click="emit('close')">esc</button>
      </div>

      <p v-if="loadError" class="panel-state">config unavailable — {{ loadError }}</p>

      <template v-else-if="config">
        <!-- Provider setup — the ONE writable slice (issue #152). -->
        <ProviderSetup :config="config" @saved="onSaved" />

        <!-- Provider — who answers, and can this machine reach them? -->
        <section class="settings-section">
          <h3 class="section-title">provider</h3>
          <div class="rows">
            <div class="row">
              <span class="row-key">active</span>
              <span class="row-value">
                {{ config.provider.label || config.provider.name }}
                <span class="row-meta">via {{ config.provider.source }}</span>
              </span>
            </div>
            <div class="row">
              <span class="row-key">model</span>
              <span class="row-value mono model-picker">
                <select
                  class="model-select"
                  :disabled="modelsLoading || modelSaving || !models?.models.length"
                  :value="selectedModel"
                  aria-label="model"
                  @change="onModelChange"
                >
                  <option v-if="!models?.models.length" value="">
                    {{ config.provider.model || "(resolved at request time)" }}
                  </option>
                  <option v-else-if="!modelIds.includes(selectedModel)" value="" disabled>
                    {{ selectedModel || "(auto)" }}
                  </option>
                  <option v-for="m in models?.models ?? []" :key="m.id" :value="m.id">
                    {{ m.id }}
                  </option>
                </select>
                <button
                  type="button"
                  class="tau-btn !px-2 !py-0.5 text-[10px]"
                  title="refresh the model catalog"
                  :disabled="modelsLoading"
                  @click="loadModels(true)"
                >
                  {{ modelsLoading ? "…" : "⟳" }}
                </button>
              </span>
            </div>
            <div class="row">
              <span class="row-key">availability</span>
              <span class="row-value availability">
                <span
                  v-for="p in config.providers"
                  :key="p.name"
                  class="provider-chip"
                  :class="p.available ? 'up' : 'down'"
                  :title="p.available ? 'available' : 'unavailable on this machine'"
                >
                  {{ p.name }} {{ p.available ? "✓" : "✕" }}
                </span>
              </span>
            </div>
            <div class="row">
              <span class="row-key">model catalog</span>
              <span class="row-value">
                {{ config.modelCatalog.count }} cached
                <span v-if="config.modelCatalog.refreshedAt" class="row-meta">
                  · refreshed {{ relTime(config.modelCatalog.refreshedAt) }}
                </span>
                <span v-else class="row-meta">· never refreshed</span>
              </span>
            </div>
            <!-- Thinking — capability-driven (issue #164): providers without
                 a knob render the honest "none" note instead of controls. -->
            <div class="row">
              <span class="row-key">thinking</span>
              <span class="row-value thinking-picker">
                <template v-if="config.thinking.capability.mode">
                  <span class="mini-picker" role="radiogroup" aria-label="thinking mode">
                    <button
                      type="button"
                      role="radio"
                      class="mini-option"
                      :class="{ on: config.thinking.config.mode === 'on' }"
                      :aria-checked="config.thinking.config.mode === 'on'"
                      :disabled="thinkingSaving"
                      @click="setThinking({ mode: 'on' })"
                    >
                      on
                    </button>
                    <button
                      type="button"
                      role="radio"
                      class="mini-option"
                      :class="{ on: config.thinking.config.mode === 'off' }"
                      :aria-checked="config.thinking.config.mode === 'off'"
                      :disabled="thinkingSaving"
                      @click="setThinking({ mode: 'off' })"
                    >
                      off
                    </button>
                  </span>
                </template>
                <template v-if="config.thinking.capability.effort">
                  <span class="mini-picker" role="radiogroup" aria-label="thinking effort">
                    <button
                      v-for="level in ['low', 'medium', 'high']"
                      :key="level"
                      type="button"
                      role="radio"
                      class="mini-option"
                      :class="{ on: config.thinking.config.effort === level }"
                      :aria-checked="config.thinking.config.effort === level"
                      :disabled="thinkingSaving"
                      @click="setThinking({ effort: level as 'low' | 'medium' | 'high' })"
                    >
                      {{ level }}
                    </button>
                  </span>
                </template>
                <span
                  v-if="!config.thinking.capability.mode && !config.thinking.capability.effort"
                  class="row-meta"
                >
                  {{ config.thinking.summary }} — {{ config.thinking.provider }} exposes no thinking
                  knobs
                </span>
              </span>
            </div>
            <p v-if="selectionError" class="selection-error">{{ selectionError }}</p>
          </div>
        </section>

        <!-- Risk policy — what the gate does before anything runs. -->
        <section class="settings-section">
          <h3 class="section-title">risk policy</h3>
          <div class="rows">
            <div class="row">
              <span class="row-key">allowMediumAutoApprove</span>
              <span class="row-value mono">{{ String(config.config.allowMediumAutoApprove) }}</span>
            </div>
            <div class="row">
              <span class="row-key">timeout</span>
              <span class="row-value mono">{{ config.config.timeout }}s per step</span>
            </div>
            <div class="row">
              <span class="row-key">shell</span>
              <span class="row-value mono">{{ config.config.shell }}</span>
            </div>
            <div class="row">
              <span class="row-key">aliases</span>
              <span class="row-value mono"
                >{{ Object.keys(config.config.aliases).length }} defined</span
              >
            </div>
          </div>
          <p class="section-hint">
            read-only — change with
            <code class="panel-code">tau config set &lt;key&gt; &lt;value&gt;</code>; the gate never
            moves into the browser
          </p>
        </section>

        <!-- Appearance — three-state theme, same state as the header button. -->
        <section class="settings-section">
          <h3 class="section-title">appearance</h3>
          <div class="theme-picker" role="radiogroup" aria-label="theme">
            <button
              v-for="option in THEME_OPTIONS"
              :key="option.value"
              type="button"
              class="theme-option"
              :class="{ on: preference === option.value }"
              role="radio"
              :aria-checked="preference === option.value"
              @click="setPreference(option.value)"
            >
              {{ option.label }}
            </button>
          </div>
          <p class="section-hint">system follows your OS light/dark setting live</p>
        </section>

        <!-- Sessions — local UI state only; the server history is durable. -->
        <section class="settings-section">
          <h3 class="section-title">sessions</h3>
          <div class="rows">
            <div class="row">
              <span class="row-key">threads</span>
              <span class="row-value mono">{{ threads.length }} / {{ MAX_THREADS }} local</span>
            </div>
            <div class="row">
              <span class="row-key">history</span>
              <span class="row-value mono">{{ history.length }} loaded</span>
            </div>
            <div class="row">
              <span class="row-key">tau home</span>
              <span class="row-value mono truncate" :title="config.tauHome">{{
                config.tauHome
              }}</span>
            </div>
          </div>
        </section>
      </template>

      <p v-else class="panel-state pulse">loading config…</p>

      <p class="modal-foot">
        provider keys stay masked (sk-***last4) — model / thinking / provider setup are the writable
        slices (per-provider request knobs); the gate never moves into the browser
      </p>
    </div>
  </div>
</template>

<style scoped>
/* Model select + thinking mini-pickers (issue #164) — capability-driven
   controls over the same read-only row primitives. */
.model-picker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.model-select {
  max-width: 220px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--tau-text);
  background: var(--tau-raised);
  border: 1px solid var(--tau-line-strong);
  border-radius: 6px;
  padding: 3px 6px;
  outline: none;
}

.model-select:focus {
  border-color: var(--tau-ok-edge);
}

.model-select:disabled {
  opacity: 0.6;
}

.thinking-picker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.mini-picker {
  display: inline-flex;
  border: 1px solid var(--tau-line-strong);
  border-radius: 6px;
  overflow: hidden;
}

.mini-option {
  border: 0;
  background: transparent;
  color: var(--tau-muted);
  font-family: var(--font-mono);
  font-size: 10.5px;
  padding: 3px 9px;
  cursor: pointer;
  transition:
    color var(--t-fast) var(--ease),
    background var(--t-fast) var(--ease);
}

.mini-option + .mini-option {
  border-left: 1px solid var(--tau-line);
}

.mini-option:hover {
  color: var(--tau-text);
  background: var(--tau-raised);
}

.mini-option.on {
  color: var(--tau-ok);
  background: var(--tau-ok-soft);
}

.mini-option:disabled {
  opacity: 0.6;
}

.selection-error {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--tau-danger);
}

/* Skeleton mirrors ShortcutsModal (overlay / panel / head / foot). */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--tau-backdrop);
  padding: 16px;
  animation: tau-enter var(--t-med) var(--ease) both;
}

.modal-panel {
  width: 100%;
  max-width: 520px;
  max-height: min(84dvh, 720px);
  overflow-y: auto;
  padding: 18px 20px;
}

.modal-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.eyebrow-label {
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--tau-faint);
}

.modal-foot {
  margin: 14px 0 0;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--tau-faint);
}

.panel-state {
  margin: 16px 0 0;
  font-size: 12.5px;
  color: var(--tau-muted);
}

.panel-state.pulse {
  animation: tau-pulse 1.1s ease-in-out infinite;
}

/* settings-section / section-title / rows / row-key / row-value /
   row-meta / section-hint live in theme.css as GLOBAL primitives —
   ProviderSetup renders inside this panel and scoped styles would not
   reach it. Panel-specific chrome only below. */

.availability {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  justify-content: flex-end;
}

.provider-chip {
  font-family: var(--font-mono);
  font-size: 10.5px;
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid var(--tau-line-strong);
  color: var(--tau-muted);
}

.provider-chip.up {
  color: var(--tau-ok);
  border-color: var(--tau-ok-edge);
  background: var(--tau-ok-soft);
}

.provider-chip.down {
  color: var(--tau-faint);
}

.section-hint {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--tau-faint);
}

.panel-code {
  font-family: var(--font-mono);
  font-size: 10.5px;
  background: var(--tau-raised);
  border: 1px solid var(--tau-line);
  border-radius: 3px;
  padding: 0 4px;
}

/* Theme segmented control — one state, three views (header button +
   this picker are views of the same useTheme() singleton). */
.theme-picker {
  display: inline-flex;
  border: 1px solid var(--tau-line-strong);
  border-radius: 8px;
  overflow: hidden;
}

.theme-option {
  border: 0;
  background: transparent;
  color: var(--tau-muted);
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 5px 14px;
  cursor: pointer;
  transition:
    color var(--t-fast) var(--ease),
    background var(--t-fast) var(--ease);
}

.theme-option + .theme-option {
  border-left: 1px solid var(--tau-line);
}

.theme-option:hover {
  color: var(--tau-text);
  background: var(--tau-raised);
}

.theme-option.on {
  color: var(--tau-ok);
  background: var(--tau-ok-soft);
}
</style>
