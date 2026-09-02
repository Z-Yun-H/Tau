/// <reference lib="dom" />
/**
 * Theme state — three-state preference ('light' | 'dark' | 'system')
 * persisted in the `tau-webui-theme-v1` localStorage key (a NEW key —
 * the pinned threads key `tau-webui-threads-v1` is untouched).
 * 'system' follows prefers-color-scheme live via matchMedia.
 *
 * The lib="dom" reference above is the ONLY DOM opt-in in client .ts
 * land (root tsconfig is node-only; every other client .ts module is
 * DOM-free by design — see lib/api.ts). Theme is the one module whose
 * entire job is DOM state, so the DOM lib is declared here, at the
 * single file that needs it, instead of widening the root config.
 *
 * Application model: `data-theme="light"` on <html> switches the ramp;
 * dark is the CSS default (`:root` in theme.css), so the attribute is
 * only ever ADDED for light — removing it returns to dark. The boot
 * script in index.html does the same resolution before first paint;
 * this composable re-applies it on change and keeps the DOM in sync.
 */

import { ref, watch } from "vue";
import { useEventListener } from "@vueuse/core";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "tau-webui-theme-v1";
const PREFERENCES: ThemePreference[] = ["system", "light", "dark"];

/** Pure resolver — unit-tested; no DOM here. */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersLight: boolean,
): ResolvedTheme {
  if (preference === "light") return "light";
  if (preference === "dark") return "dark";
  return systemPrefersLight ? "light" : "dark";
}

function readStoredPreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return PREFERENCES.includes(raw as ThemePreference) ? (raw as ThemePreference) : "system";
  } catch {
    return "system";
  }
}

function applyTheme(resolved: ResolvedTheme): void {
  /* No DOM (node test env / SSR): the boot script owns first paint there. */
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (resolved === "light") root.setAttribute("data-theme", "light");
  else root.removeAttribute("data-theme");
}

const preference = ref<ThemePreference>(readStoredPreference());
const systemPrefersLight = ref(
  typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches,
);
const resolved = ref<ResolvedTheme>(resolveTheme(preference.value, systemPrefersLight.value));

/* Live-follow the OS scheme while in 'system'. */
if (typeof window !== "undefined") {
  useEventListener(
    window.matchMedia("(prefers-color-scheme: light)"),
    "change",
    (event: MediaQueryListEvent) => {
      systemPrefersLight.value = event.matches;
    },
  );
}

watch(
  [preference, systemPrefersLight],
  ([pref, light]) => {
    resolved.value = resolveTheme(pref, light);
    applyTheme(resolved.value);
    try {
      if (pref === "system") localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, pref);
    } catch {
      /* private-mode denial: preference stays in-memory */
    }
  },
  { immediate: true },
);

/** Shared reactive theme state (module singleton — one listener per page). */
export function useTheme() {
  function setPreference(next: ThemePreference): void {
    preference.value = next;
  }
  /** StatusHeader button: cycle system → light → dark → system. */
  function cyclePreference(): void {
    const index = PREFERENCES.indexOf(preference.value);
    preference.value = PREFERENCES[(index + 1) % PREFERENCES.length] ?? "system";
  }
  return { preference, resolved, setPreference, cyclePreference };
}
