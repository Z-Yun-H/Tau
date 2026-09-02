import { defineConfig, presetWind3 } from "unocss";

/**
 * UnoCSS for the Tau WebUI — "terminal precision" design system.
 *
 * Single source of the color tokens (theme.colors.tau): a dark neutral
 * ramp fused to the page bg, plus the ONE semantic system (the risk
 * levels). Typography and motion tokens live in client/theme.css.
 *
 * Avoid-AI-cliché rules baked into the shortcuts: no shadows (except the
 * composer's one soft elevation), no gradients on data surfaces, no
 * glassmorphism — hierarchy comes from the ramp, hairlines, and
 * typographic contrast. The chrome sweep is reserved for the brand mark
 * and the Run plan primary action (see DESIGN.md §3 "Accent — chrome").
 */
export default defineConfig({
  presets: [presetWind3()],
  theme: {
    fontFamily: {
      /* stacks live in theme.css as vars — utilities emit the var() */
      sans: "var(--font-sans)",
      mono: "var(--font-mono)",
      serif: "var(--font-serif)",
      /* alias `font-ui` → sans for migration safety (old utilities) */
      ui: "var(--font-sans)",
    },
    colors: {
      tau: {
        /* neutral ramp: page → panel → raised → active — fused tones,
           separated by hairlines, not tonal jumps (chat.z.ai move). */
        bg: "#0b0e13",
        panel: "#0e1219",
        raised: "#141a24",
        active: "#1b2331",
        /* hairlines */
        line: "#1b2230",
        "line-strong": "#28303f",
        /* text: primary / muted / faint / placeholder */
        text: "#e6ebf2",
        muted: "#9aa5b4",
        faint: "#5c6776",
        placeholder: "#3f4856",
        /* semantic: the risk levels + provider info accent */
        ok: "#5ec97a",
        warn: "#e0a53c",
        danger: "#e5534b",
        blocked: "#6e7887",
        info: "#6bb3d9",
        /* chrome sweep — 9 stops, used only on brand mark + Run plan */
        "chrome-1": "#191a1d",
        "chrome-2": "#222327",
        "chrome-3": "#44454d",
        "chrome-4": "#747689",
        "chrome-5": "#a8aab8",
        "chrome-6": "#747689",
        "chrome-7": "#44454d",
        "chrome-8": "#222327",
        "chrome-9": "#191a1d",
      },
    },
  },
  shortcuts: {
    /* surfaces */
    "tau-card": "border border-tau-line bg-tau-panel rounded-12px my-2 px-4 py-3.5",
    "tau-panel": "border border-tau-line bg-tau-panel rounded-12px",

    /* risk badge — the shared semantic atom (text color + tint + line) */
    "tau-badge": "rounded-4px px-1.5 py-px text-[11px] leading-4.5 font-mono inline-block border",

    /* controls — color/border transitions only, no transforms */
    "tau-btn":
      "inline-flex items-center justify-center gap-1.5 bg-transparent text-tau-text border border-tau-line-strong rounded-8px px-3 py-1.5 cursor-pointer font-sans text-[13px] transition-colors duration-120 ease-out hover:bg-tau-raised hover:border-tau-faint disabled:opacity-45 disabled:cursor-not-allowed disabled:pointer-events-none",
    "tau-btn-primary":
      "inline-flex items-center justify-center gap-1.5 bg-tau-ok/12 text-tau-ok border border-tau-ok/50 rounded-8px px-3.5 py-1.5 cursor-pointer font-sans text-[13px] font-medium transition-colors duration-120 ease-out hover:bg-tau-ok/22 hover:border-tau-ok disabled:opacity-45 disabled:cursor-not-allowed",
    "tau-btn-chrome":
      "tau-chrome-text inline-flex items-center justify-center gap-1.5 border border-tau-chrome-3 rounded-8px px-4 py-2 cursor-pointer font-sans text-[13px] font-medium transition-[background-position] duration-300 ease-out hover:tau-chrome-text-hover disabled:opacity-45 disabled:cursor-not-allowed disabled:pointer-events-none",
    "tau-btn-danger-hover":
      "transition-colors duration-120 ease-out hover:border-tau-danger hover:text-tau-danger",
    "tau-input":
      "w-full bg-tau-panel text-tau-text border border-tau-line-strong rounded-8px px-3 py-2 outline-none font-sans text-[13px] placeholder:text-tau-placeholder transition-colors duration-120 ease-out focus:border-tau-ok/60",

    /* meta chips */
    "tau-chip":
      "border border-tau-line rounded-6px px-2 py-0.5 text-[11px] leading-4.5 font-mono text-tau-muted inline-flex items-center gap-1 whitespace-nowrap overflow-hidden",
  },
});
