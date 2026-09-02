/**
 * Theme state unit tests (lib/theme.ts) — the pure resolver matrix and the
 * three-state cycle/persistence contract of the shared composable.
 *
 * Runs in the node vitest environment: lib/theme.ts is the one client .ts
 * module allowed to touch DOM globals (see the lib="dom" note there), and
 * every DOM contact is guarded — `document`/`window` are absent here, and
 * a stubbed `localStorage` stands in for persistence. The module singleton
 * is imported dynamically AFTER the storage stub is installed so its
 * module-level read sees the stub.
 */
import { describe, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import type { ThemePreference } from "../client/lib/theme.js";

const store = new Map<string, string>();
const storage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value);
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
};
vi.stubGlobal("localStorage", storage);

const { THEME_STORAGE_KEY, resolveTheme, useTheme } = await import("../client/lib/theme.js");

describe("resolveTheme (pure)", () => {
  it("explicit light/dark win over the OS scheme", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("'system' follows prefers-color-scheme", () => {
    expect(resolveTheme("system", true)).toBe("light");
    expect(resolveTheme("system", false)).toBe("dark");
  });
});

describe("useTheme cycle + persistence", () => {
  it("starts as 'system' when nothing is stored", () => {
    expect(useTheme().preference.value).toBe("system");
  });

  it("cycles system → light → dark → system (StatusHeader button order)", () => {
    const { preference, cyclePreference } = useTheme();
    expect(preference.value).toBe("system");
    cyclePreference();
    expect(preference.value).toBe("light");
    cyclePreference();
    expect(preference.value).toBe("dark");
    cyclePreference();
    expect(preference.value).toBe("system");
  });

  it("persists an explicit choice; 'system' removes the key (absence = system)", async () => {
    const { setPreference } = useTheme();
    /* watch flushes on the microtask queue — persistence assertions need
       nextTick() after each change (the cycle test above only reads the
       synchronous ref, so it does not). */
    setPreference("light");
    await nextTick();
    expect(store.get(THEME_STORAGE_KEY)).toBe("light");
    setPreference("dark");
    await nextTick();
    expect(store.get(THEME_STORAGE_KEY)).toBe("dark");
    setPreference("system");
    await nextTick();
    expect(store.has(THEME_STORAGE_KEY)).toBe(false);
  });

  it("an invalid stored value falls back to 'system'", async () => {
    vi.resetModules();
    store.set(THEME_STORAGE_KEY, "sepia" as unknown as ThemePreference);
    const fresh = await import("../client/lib/theme.js");
    expect(fresh.useTheme().preference.value).toBe("system");
    expect(store.has(THEME_STORAGE_KEY)).toBe(false);
  });
});
