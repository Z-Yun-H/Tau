import { defineConfig, presetWind3 } from "unocss";

/**
 * UnoCSS for the Tau WebUI — "terminal precision" design system.
 *
 * This file is the single source of the color tokens (theme.colors.tau):
 * a neutral dark ramp plus the ONE semantic system, the risk levels.
 * Typography and motion tokens live in client/theme.css. Attribute/auto
 * prefixes stay off; only default utilities are used.
 *
 * Avoid-AI-cliché rules baked into the shortcuts: no shadows, no gradients,
 * no glass, restrained radii — hierarchy comes from the ramp, hairlines and
 * typographic contrast instead.
 */
export default defineConfig({
  presets: [presetWind3()],
  theme: {
    fontFamily: {
      /* stacks live in theme.css as vars — utilities emit the var() */
      ui: "var(--font-ui)",
      mono: "var(--font-mono)",
    },
    colors: {
      tau: {
        /* neutral ramp: page → panel → raised → active */
        bg: "#0a0d12",
        panel: "#0f131a",
        raised: "#151b24",
        active: "#1c2430",
        /* hairlines */
        line: "#1e2530",
        "line-strong": "#2a3342",
        /* text: primary / muted / faint */
        text: "#e3e9f0",
        muted: "#93a0af",
        faint: "#5c6878",
        /* semantic: the risk levels + provider info accent */
        ok: "#5ec97a",
        warn: "#d9a03c",
        danger: "#e5534b",
        blocked: "#6e7887",
        info: "#6bb3d9",
      },
    },
  },
  shortcuts: {
    /* surfaces */
    "tau-card": "border border-tau-line bg-tau-panel rounded-10px my-2.5 px-3.5 py-3",
    "tau-panel": "border border-tau-line bg-tau-panel rounded-10px",

    /* risk badge — the shared semantic atom (text color + tint + line) */
    "tau-badge": "rounded-4px px-1.5 py-px text-[11px] leading-4.5 font-mono inline-block border",

    /* controls: color/border transitions only, no transforms */
    "tau-btn":
      "inline-flex items-center justify-center gap-1.5 bg-transparent text-tau-text border border-tau-line-strong rounded-6px px-3 py-1.5 cursor-pointer font-ui text-[13px] transition-colors duration-120 ease-out hover:bg-tau-raised hover:border-tau-faint disabled:opacity-45 disabled:cursor-not-allowed disabled:pointer-events-none",
    "tau-btn-primary":
      "inline-flex items-center justify-center gap-1.5 bg-tau-ok/10 text-tau-ok border border-tau-ok/45 rounded-6px px-3 py-1.5 cursor-pointer font-ui text-[13px] transition-colors duration-120 ease-out hover:bg-tau-ok/20 hover:border-tau-ok disabled:opacity-45 disabled:cursor-not-allowed",
    "tau-btn-danger-hover":
      "transition-colors duration-120 ease-out hover:border-tau-danger hover:text-tau-danger",
    "tau-input":
      "w-full bg-tau-panel text-tau-text border border-tau-line-strong rounded-6px px-3 py-2 outline-none font-ui text-[13px] placeholder:text-tau-faint transition-colors duration-120 ease-out focus:border-tau-ok/60",

    /* meta chips */
    "tau-chip":
      "border border-tau-line rounded-4px px-2 py-0.5 text-[11px] leading-4.5 font-mono text-tau-muted inline-flex items-center gap-1 whitespace-nowrap overflow-hidden",
  },
});
