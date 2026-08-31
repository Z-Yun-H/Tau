import { defineConfig, presetWind3 } from "unocss";

/**
 * UnoCSS for the Tau WebUI — the dark terminal aesthetic (former
 * public/style.css) expressed as a theme + a handful of shortcuts so the
 * SFC templates stay readable. Attribute/auto prefixes stay off; only the
 * default utilities are used.
 */
export default defineConfig({
  presets: [presetWind3()],
  theme: {
    colors: {
      tau: {
        bg: "#0d1117",
        panel: "#161b22",
        border: "#2d333b",
        text: "#e6edf3",
        muted: "#8b949e",
        brand: "#7ee787",
        warn: "#e3b341",
        danger: "#f85149",
      },
    },
  },
  shortcuts: {
    "tau-chip": "border border-tau-border rounded-full px-2.5 py-0.5 text-xs text-tau-muted",
    "tau-card": "border border-tau-border rounded-10px bg-tau-panel my-2.5 px-3.5 py-3",
    "tau-badge": "rounded-md px-2 py-px text-[11px] border border-tau-border inline-block",
    "tau-btn":
      "bg-tau-panel text-tau-text border border-tau-border rounded-lg px-3.5 py-2 cursor-pointer font-inherit hover:border-tau-brand hover:text-tau-brand disabled:opacity-50 disabled:cursor-not-allowed",
    "tau-input":
      "flex-1 bg-tau-panel text-tau-text border border-tau-border rounded-lg px-3 py-2.5 outline-none focus:border-tau-brand",
  },
});
