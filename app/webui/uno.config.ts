import { defineConfig, presetWind3 } from "unocss";

/**
 * UnoCSS for the Tau WebUI — "terminal precision" design system.
 *
 * The `tau.*` colors map to the `--tau-*` CSS variables defined in
 * client/theme.css — THE single source of truth, which ships both the dark
 * (default) and light ramps; utilities follow the active theme without
 * class-name changes. Do not put raw hex here.
 *
 * Semantic colors expose a two-step system (`-soft` surface tint, `-edge`
 * control border) instead of ad-hoc alpha modifiers — var()-based colors
 * cannot use the `/opacity` syntax, and per-theme tuning belongs to the
 * token layer anyway.
 *
 * Avoid-AI-cliché rules baked into the shortcuts: no gratuitous gradients
 * on data surfaces (the metallic chrome sweep is reserved for the brand
 * mark and the Run plan primary action), no glassmorphism. Surfaces are
 * LAYERED — cards/panels carry the `.tau-surface*` elevation treatment
 * from theme.css; a bare 1px hairline on a flat background is a design
 * bug (DESIGN.md §3).
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
        /* neutral ramp — vars resolve per theme (dark default, light on
           html[data-theme="light"]); see theme.css for both ramps. */
        bg: "var(--tau-bg)",
        panel: "var(--tau-panel)",
        raised: "var(--tau-raised)",
        active: "var(--tau-active)",
        /* hairlines (small controls only — surfaces use .tau-surface*) */
        line: "var(--tau-line)",
        "line-strong": "var(--tau-line-strong)",
        /* text: primary / muted / faint / placeholder */
        text: "var(--tau-text)",
        muted: "var(--tau-muted)",
        faint: "var(--tau-faint)",
        placeholder: "var(--tau-placeholder)",
        /* semantic: the risk levels + provider info accent */
        ok: "var(--tau-ok)",
        warn: "var(--tau-warn)",
        danger: "var(--tau-danger)",
        blocked: "var(--tau-blocked)",
        info: "var(--tau-info)",
        /* semantic two-step tints/borders (theme-tuned alphas) */
        "ok-soft": "var(--tau-ok-soft)",
        "ok-edge": "var(--tau-ok-edge)",
        "warn-soft": "var(--tau-warn-soft)",
        "warn-edge": "var(--tau-warn-edge)",
        "danger-soft": "var(--tau-danger-soft)",
        "danger-edge": "var(--tau-danger-edge)",
        "info-soft": "var(--tau-info-soft)",
        "info-edge": "var(--tau-info-edge)",
        /* chrome sweep — 9 stops, used only on brand mark + Run plan */
        "chrome-1": "var(--tau-chrome-1)",
        "chrome-2": "var(--tau-chrome-2)",
        "chrome-3": "var(--tau-chrome-3)",
        "chrome-4": "var(--tau-chrome-4)",
        "chrome-5": "var(--tau-chrome-5)",
        "chrome-6": "var(--tau-chrome-6)",
        "chrome-7": "var(--tau-chrome-7)",
        "chrome-8": "var(--tau-chrome-8)",
        "chrome-9": "var(--tau-chrome-9)",
      },
    },
  },
  shortcuts: {
    /* surfaces — layered: the .tau-surface* classes (theme.css) add the
       gradient edge + elevation; spacing/radius stay utilities here. */
    "tau-card": "tau-surface rounded-12px my-2 px-4 py-3.5",
    "tau-panel": "tau-surface rounded-12px",

    /* risk badge — the shared semantic atom (text color + tint + edge) */
    "tau-badge": "rounded-4px px-1.5 py-px text-[11px] leading-4.5 font-mono inline-block border",

    /* controls — color/border transitions only, no transforms */
    "tau-btn":
      "inline-flex items-center justify-center gap-1.5 bg-transparent text-tau-text border border-tau-line-strong rounded-8px px-3 py-1.5 cursor-pointer font-sans text-[13px] transition-colors duration-120 ease-out hover:bg-tau-raised hover:border-tau-faint disabled:opacity-45 disabled:cursor-not-allowed disabled:pointer-events-none",
    "tau-btn-primary":
      "inline-flex items-center justify-center gap-1.5 bg-tau-ok-soft text-tau-ok border border-tau-ok-edge rounded-8px px-3.5 py-1.5 cursor-pointer font-sans text-[13px] font-medium transition-colors duration-120 ease-out hover:bg-tau-ok-soft hover:border-tau-ok disabled:opacity-45 disabled:cursor-not-allowed",
    "tau-btn-chrome":
      "tau-chrome-text inline-flex items-center justify-center gap-1.5 border border-tau-chrome-3 rounded-8px px-4 py-2 cursor-pointer font-sans text-[13px] font-medium transition-[background-position] duration-300 ease-out hover:tau-chrome-text-hover disabled:opacity-45 disabled:cursor-not-allowed disabled:pointer-events-none",
    "tau-btn-danger-hover":
      "transition-colors duration-120 ease-out hover:border-tau-danger hover:text-tau-danger",
    "tau-input":
      "w-full bg-tau-panel text-tau-text border border-tau-line-strong rounded-8px px-3 py-2 outline-none font-sans text-[13px] placeholder:text-tau-placeholder transition-colors duration-120 ease-out focus:border-tau-ok-edge",

    /* meta chips */
    "tau-chip":
      "border border-tau-line rounded-6px px-2 py-0.5 text-[11px] leading-4.5 font-mono text-tau-muted inline-flex items-center gap-1 whitespace-nowrap overflow-hidden",
  },
});
