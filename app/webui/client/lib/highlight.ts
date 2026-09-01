/**
 * Shiki-based code highlighting — progressive by contract: the page renders
 * plain (escaped) markdown first, then this module upgrades fenced blocks in
 * place. Per shiki's documented fine-grained usage: one shared highlighter,
 * a small language/theme set, dynamic import so the main chunk stays lean,
 * and ANY failure is a silent no-op (plain text is always a valid final
 * state — highlighting is an enhancement, never a dependency).
 *
 * DOM-free typing: structural interfaces instead of DOM globals (the root
 * tsconfig has no DOM lib) — Vue elements satisfy them structurally.
 */

import type { Highlighter } from "shiki";

/** Languages fenced code actually carries in this UI (bash dominates). */
const LANGS = ["bash", "shell", "typescript", "javascript", "json", "python"] as const;
const THEME = "one-dark-pro";

let highlighterPromise: Promise<Highlighter | null> | null = null;

async function getHighlighter(): Promise<Highlighter | null> {
  highlighterPromise ??= import("shiki")
    .then((shiki) =>
      shiki.createHighlighter({
        themes: [THEME],
        langs: LANGS as unknown as string[],
      }),
    )
    .catch(() => null);
  return highlighterPromise;
}

/** Map a fence's data-lang to a loaded shiki language (or plain text). */
function langFor(dataLang: string, loaded: string[]): string {
  const normalized = dataLang.toLowerCase();
  if (loaded.includes(normalized)) return normalized;
  if (normalized === "sh" || normalized === "zsh" || normalized === "console") return "bash";
  return "text";
}

/** Structural subset of a code element — satisfied by DOM Element. */
interface HighlightableCode {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  textContent: string | null;
  parentElement: { outerHTML: string } | null;
}

/** Structural subset of a query root — satisfied by DOM Element/document. */
interface HighlightableRoot {
  querySelectorAll(selector: string): Iterable<HighlightableCode>;
}

/**
 * Upgrade every `pre code` block under `root` that has not been highlighted
 * yet. Blocks without a loaded language render through shiki's `text` lang
 * (theme background only) — visually consistent, zero risk.
 */
export async function highlightPreBlocks(root: HighlightableRoot): Promise<void> {
  const highlighter = await getHighlighter();
  if (!highlighter) return;
  const blocks = root.querySelectorAll("pre code:not([data-shiki])");
  const loaded = highlighter.getLoadedLanguages();
  for (const block of blocks) {
    block.setAttribute("data-shiki", "1");
    const code = block.textContent ?? "";
    if (!code.trim()) continue;
    const lang = langFor(block.getAttribute("data-lang") ?? "", loaded);
    try {
      const html = highlighter.codeToHtml(code.replace(/\n$/, ""), { lang, theme: THEME });
      // Swap the surrounding <pre> (shiki emits its own pre/code shell)
      const pre = block.parentElement;
      if (pre) {
        pre.outerHTML = html;
      }
    } catch {
      // leave the plain block as-is
    }
  }
}
