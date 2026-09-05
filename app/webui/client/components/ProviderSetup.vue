<script setup lang="ts">
/**
 * ProviderSetup — the ONE writable slice of the settings panel (issue
 * #152). Three steps, no endpoint typing:
 *
 *   1. pick a provider (the endpoint is looked up from the server-sent
 *      catalog — `defaultBaseUrl` prefills; advanced <details> to override)
 *   2. paste the API key
 *   3. save — through POST /api/config/provider, the same setConfigValue
 *      channel `tau provider set-key` uses (chmod-0600 config file)
 *
 * Privacy (防窥): the key input is type="password"; the show toggle
 * re-masks itself after 8s so a shoulder-surfer cannot camp on it. A
 * saved key appears only as the server's mask ("sk-***last4") — the
 * plaintext is never echoed back, never logged, never copied.
 */
import { computed, onBeforeUnmount, ref } from "vue";
import { postJson, type ConfigPayload } from "../lib/api.js";

const props = defineProps<{ config: ConfigPayload }>();
const emit = defineEmits<{ saved: [config: ConfigPayload] }>();

const selectedName = ref("");
const selected = computed(() =>
  props.config.providerCatalog.find((p) => p.name === selectedName.value),
);

/** Availability chip state from the live /api/config availability list. */
function isAvailable(name: string): boolean {
  return props.config.providers.find((p) => p.name === name)?.available ?? false;
}
function isKeySaved(name: string): boolean {
  const entry = props.config.config.providers[name];
  return Boolean(entry && typeof entry.apiKey === "string" && entry.apiKey.length > 0);
}
function savedMask(name: string): string {
  return String(props.config.config.providers[name]?.apiKey ?? "");
}

/** Endpoint prefill: the catalog default, overridden by any saved value. */
const baseUrl = ref("");
const keyInput = ref("");
const keyVisible = ref(false);
/** Auto re-mask timer — privacy falls back to hidden without user action. */
let remaskTimer: ReturnType<typeof setTimeout> | undefined;

const isActive = computed(() => props.config.provider.name === selectedName.value);
const activate = ref(false);
const saving = ref(false);
const error = ref("");
const savedFlash = ref("");

function select(name: string): void {
  selectedName.value = name;
  const saved = props.config.config.providers[name];
  const savedUrl = saved?.baseUrl ?? saved?.host;
  baseUrl.value = String(savedUrl ?? selected.value?.defaultBaseUrl ?? "");
  activate.value = !props.config.provider.name.startsWith(name);
  keyInput.value = "";
  keyVisible.value = false;
  error.value = "";
  savedFlash.value = "";
}

function toggleVisible(): void {
  keyVisible.value = !keyVisible.value;
  clearTimeout(remaskTimer);
  // 防窥: an explicit peek re-masks itself — no lingering plaintext.
  if (keyVisible.value) {
    remaskTimer = setTimeout(() => {
      keyVisible.value = false;
    }, 8_000);
  }
}
onBeforeUnmount(() => clearTimeout(remaskTimer));

async function save(): Promise<void> {
  if (!selectedName.value || saving.value) return;
  saving.value = true;
  error.value = "";
  savedFlash.value = "";
  try {
    const body: Record<string, unknown> = { provider: selectedName.value };
    const trimmedKey = keyInput.value.trim();
    if (trimmedKey) body["apiKey"] = trimmedKey;
    if (baseUrl.value.trim() && baseUrl.value.trim() !== selected.value?.defaultBaseUrl) {
      body["baseUrl"] = baseUrl.value.trim();
    }
    if (activate.value && !isActive.value) body["activate"] = true;
    const next = await postJson<ConfigPayload>("/api/config/provider", body);
    savedFlash.value = trimmedKey
      ? "key saved — shown masked here and in `tau config list`"
      : "provider settings saved";
    keyInput.value = "";
    keyVisible.value = false;
    emit("saved", next);
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section class="settings-section">
    <h3 class="section-title">provider setup</h3>
    <p class="section-hint">
      pick a provider — the endpoint is looked up for you; paste a key and save
    </p>

    <div class="provider-picker" role="radiogroup" aria-label="provider">
      <button
        v-for="p in config.providerCatalog"
        :key="p.name"
        type="button"
        role="radio"
        :aria-checked="selectedName === p.name"
        class="provider-option"
        :class="{ on: selectedName === p.name, active: config.provider.name === p.name }"
        :title="p.label"
        @click="select(p.name)"
      >
        {{ p.name }}
        <span class="opt-state" :class="isAvailable(p.name) ? 'up' : 'down'">{{
          isAvailable(p.name) ? "✓" : "✕"
        }}</span>
        <span v-if="isKeySaved(p.name)" class="opt-key" title="a key is saved (masked)">·key</span>
      </button>
    </div>

    <template v-if="selected">
      <div class="rows setup-rows">
        <div class="row">
          <span class="row-key">endpoint</span>
          <span class="row-value mono" :title="baseUrl">{{ baseUrl || "(provider default)" }}</span>
        </div>

        <details v-if="selected.defaultBaseUrl" class="advanced">
          <summary>advanced — custom endpoint</summary>
          <input
            v-model="baseUrl"
            type="text"
            class="base-input"
            spellcheck="false"
            :placeholder="selected.defaultBaseUrl"
            aria-label="custom endpoint"
          />
        </details>

        <div class="row">
          <span class="row-key">saved</span>
          <span class="row-value mono">{{
            isKeySaved(selected.name) ? savedMask(selected.name) : "(not set)"
          }}</span>
        </div>
      </div>

      <p v-if="selected.note" class="section-hint">{{ selected.note }}</p>
      <a
        v-if="selected.consoleUrl"
        class="console-link"
        :href="selected.consoleUrl"
        target="_blank"
        rel="noreferrer noopener"
      >
        get a {{ selected.name }} key ↗
      </a>

      <div v-if="!selected.keyless" class="key-row">
        <input
          v-model="keyInput"
          :type="keyVisible ? 'text' : 'password'"
          class="key-input"
          :placeholder="`paste ${selected.name} api key`"
          autocomplete="off"
          spellcheck="false"
          aria-label="api key"
          @keydown.enter.prevent="save"
        />
        <button
          type="button"
          class="tau-btn !px-2 !py-1 text-[10px]"
          :title="
            keyVisible ? 'hide the key (auto re-masks in 8s)' : 'show the key (re-masks in 8s)'
          "
          @click="toggleVisible"
        >
          {{ keyVisible ? "hide" : "show" }}
        </button>
      </div>

      <div class="save-row">
        <label v-if="!isActive" class="activate-label">
          <input v-model="activate" type="checkbox" />
          make {{ selected.name }} the active provider
        </label>
        <span v-else class="activate-label on">active provider</span>
        <span class="flex-1" />
        <button type="button" class="tau-btn" :disabled="saving" @click="save">
          {{ saving ? "saving…" : "save" }}
        </button>
      </div>

      <p v-if="error" class="setup-error">{{ error }}</p>
      <p v-if="savedFlash" class="setup-ok">{{ savedFlash }}</p>
    </template>
  </section>
</template>

<style scoped>
.provider-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}

.provider-option {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 6px;
  border: 1px solid var(--tau-line-strong);
  background: transparent;
  color: var(--tau-muted);
  cursor: pointer;
  transition:
    color var(--t-fast) var(--ease),
    border-color var(--t-fast) var(--ease),
    background var(--t-fast) var(--ease);
}

.provider-option:hover {
  color: var(--tau-text);
  background: var(--tau-raised);
}

.provider-option.on {
  color: var(--tau-ok);
  border-color: var(--tau-ok-edge);
  background: var(--tau-ok-soft);
}

.provider-option.active {
  border-style: dashed;
  border-color: var(--tau-ok-edge);
}

.opt-state.up {
  color: var(--tau-ok);
}

.opt-state.down {
  color: var(--tau-faint);
}

.opt-key {
  color: var(--tau-info);
}

.setup-rows {
  margin-top: 10px;
}

.advanced {
  font-size: 11px;
  color: var(--tau-faint);
}

.advanced summary {
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: 10.5px;
}

.base-input {
  width: 100%;
  margin-top: 4px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--tau-text);
  background: var(--tau-raised);
  border: 1px solid var(--tau-line-strong);
  border-radius: 6px;
  padding: 5px 8px;
  outline: none;
}

.base-input:focus {
  border-color: var(--tau-ok-edge);
}

.console-link {
  display: inline-block;
  margin-top: 8px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--tau-info);
  text-decoration: none;
  border-bottom: 1px solid var(--tau-info-edge);
}

.key-row {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-top: 10px;
}

.key-input {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--tau-text);
  background: var(--tau-raised);
  border: 1px solid var(--tau-line-strong);
  border-radius: 6px;
  padding: 6px 9px;
  outline: none;
}

.key-input:focus {
  border-color: var(--tau-ok-edge);
}

.save-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.activate-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--tau-muted);
  cursor: pointer;
}

.activate-label.on {
  color: var(--tau-ok);
}

.setup-error {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--tau-danger);
}

.setup-ok {
  margin: 8px 0 0;
  font-size: 11px;
  color: var(--tau-ok);
}
</style>
