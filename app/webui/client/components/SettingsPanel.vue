<script setup lang="ts">
/**
 * SettingsPanel — the read-only settings surface (Issue #86, unit 4/5).
 * One modal, four sections: provider (who answers), risk policy (what the
 * gate auto-approves), appearance (theme), sessions (local thread state).
 *
 * Everything here is a VIEW of `GET /api/config` — the redacted effective
 * config, produced by the same `redactConfig` `tau config list` uses, so
 * keys arrive as "sk-***last4", never plaintext. There is deliberately NO
 * write path: config changes stay in the CLI (`tau config set …`) — the
 * browser never becomes a second way into the safety-relevant
 * configuration. Reuses the ShortcutsModal skeleton (overlay / panel /
 * esc) and the theme singleton from lib/theme.ts, so the segmented control
 * and the StatusHeader cycle button are two views of one state.
 */
import { onMounted, ref } from "vue";
import { api, type ConfigPayload } from "../lib/api.js";
import { relTime } from "../lib/format.js";
import { MAX_THREADS, usePlanFlow } from "../composables/plan-flow.js";
import { useSession } from "../composables/session.js";
import { useTheme, type ThemePreference } from "../lib/theme.js";
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

onMounted(async () => {
  try {
    config.value = await api<ConfigPayload>("/api/config");
  } catch (error) {
    loadError.value = (error as Error).message;
  }
});
</script>

<template>
  <div class="modal-overlay" @click.self="emit('close')">
    <div class="modal-panel tau-surface rounded-12px" role="dialog" aria-label="settings">
      <div class="modal-head">
        <span class="eyebrow-label">settings</span>
        <RiskBadge level="low" label="read-only" />
        <span class="flex-1" />
        <button class="tau-btn !px-2.5 !py-1 text-[11px]" @click="emit('close')">esc</button>
      </div>

      <p v-if="loadError" class="panel-state">config unavailable — {{ loadError }}</p>

      <template v-else-if="config">
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
              <span class="row-value mono">{{
                config.provider.model || "(resolved at request time)"
              }}</span>
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
        provider keys stay masked (sk-***last4) — nothing here can change the config
      </p>
    </div>
  </div>
</template>

<style scoped>
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

.settings-section {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 0;
  background-image: linear-gradient(90deg, transparent, var(--tau-line), transparent);
  background-repeat: no-repeat;
  background-size: 100% 1px;
  background-position: top;
}

.section-title {
  margin: 0 0 8px;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--tau-faint);
}

.rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.row-key {
  flex: none;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--tau-muted);
}

.row-value {
  font-size: 12.5px;
  color: var(--tau-text);
  text-align: right;
}

.row-value.mono {
  font-family: var(--font-mono);
  font-size: 11.5px;
}

.row-value.truncate {
  overflow: hidden;
  max-width: 280px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-meta {
  color: var(--tau-faint);
  font-size: 11px;
}

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
