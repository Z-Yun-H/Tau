/**
 * Slash-suggestion overlay (suggestFromList) — a filter-as-you-type command
 * palette in the exact mechanics of picker.ts: raw-mode keypress handling,
 * pure-ANSI redraws, injectable streams, graceful non-TTY dismissal.
 *
 * Integration contract: the primitive only READS the given stream. A host
 * that owns a readline interface (the TUI REPL) must first pause its
 * interface and detach readline's keypress listeners, then run the overlay,
 * then restore — the overlay never opens a second reader itself, keeping
 * the host's single-reader guarantee intact.
 *
 * Zero dependencies beyond chalk; streams are injectable for tests; when
 * the stream cannot go raw the overlay dismisses immediately instead of
 * hanging.
 */

import readline from "node:readline";
import chalk from "chalk";

export interface SuggestItem {
  /** Full text inserted on selection, e.g. "/md ". */
  value: string;
  /** Display form with the argument hint, e.g. "/md <file>". */
  usage: string;
  /** One-line description rendered after the usage. */
  description: string;
}

export interface SuggestResult {
  /** "select" — an item was chosen; "dismiss" — the panel closed otherwise. */
  action: "select" | "dismiss";
  /** The selected item's value, or null on dismiss. */
  value: string | null;
  /** Final filter text — callers sync their own input buffer with it. */
  filter: string;
}

export interface SuggestOptions {
  /** Filter to start from, e.g. the "/" the user already typed. */
  initialFilter: string;
  /** Candidate items, already formatted by the caller. */
  items: SuggestItem[];
  /** Extra hint text for the footer row (key hints + count are appended). */
  hint?: string;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  /** Max visible rows before the window scrolls (default 8). */
  viewport?: number;
}

const DEFAULT_VIEWPORT = 8;

export async function suggestFromList(options: SuggestOptions): Promise<SuggestResult> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const isTTY = Boolean((input as NodeJS.ReadStream & { isTTY?: boolean }).isTTY);
  const canRaw = typeof (input as NodeJS.ReadStream).setRawMode === "function" && isTTY;
  if (options.items.length === 0 || !canRaw) {
    // Nothing interactive is possible — hand the filter back untouched.
    return { action: "dismiss", value: null, filter: options.initialFilter };
  }
  return suggestByKeypress(options, input, output);
}

function suggestByKeypress(
  options: SuggestOptions,
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): Promise<SuggestResult> {
  return new Promise((resolve) => {
    const out = output as NodeJS.WriteStream;
    const viewport = options.viewport ?? DEFAULT_VIEWPORT;
    const dismissOnEmpty = options.initialFilter.length > 0;

    let filter = options.initialFilter;
    let drawnRows = 0;
    let view = recompute();

    const rawInput = input as NodeJS.ReadStream & { isRaw?: boolean };
    const rawWasEnabled = rawInput.isRaw === true;
    rawInput.setRawMode(true);
    readline.emitKeypressEvents(input);

    render();

    /** Re-run the prefix filter; returns a fresh view (cursor at top). */
    function recompute(): { matches: SuggestItem[]; cursor: number; start: number } {
      const needle = filter.toLowerCase();
      const matches = options.items.filter((item) => item.value.toLowerCase().startsWith(needle));
      return { matches, cursor: 0, start: 0 };
    }

    function refresh(): void {
      const keepValue = view.matches[view.cursor]?.value;
      view = recompute();
      // Keep the same item under the cursor when it survives the filter.
      if (keepValue !== undefined) {
        const index = view.matches.findIndex((item) => item.value === keepValue);
        if (index >= 0) {
          const height = Math.min(viewport, view.matches.length);
          view.cursor = index;
          view.start = computeWindow(index, view.matches.length, height);
        }
      }
      redraw();
    }

    function finish(result: SuggestResult): void {
      input.removeListener("keypress", onKeypress);
      clearPanel();
      try {
        rawInput.setRawMode(rawWasEnabled);
      } catch {
        /* stream already closed */
      }
      resolve(result);
    }

    /** Erase the panel below the prompt; cursor ends on the prompt row. */
    function clearPanel(): void {
      if (drawnRows === 0) return;
      out.write("\x1b[1B");
      for (let i = 0; i < drawnRows; i++) {
        out.write("\x1b[2K");
        if (i < drawnRows - 1) out.write("\n");
      }
      out.write(`\x1b[${drawnRows}A\r`);
      drawnRows = 0;
    }

    function redraw(): void {
      clearPanel();
      render();
    }

    /** Draw the panel on the rows BELOW the prompt row (row R). The first
     * \n moves off the prompt row, so \x1b[2K never touches the prompt. */
    function render(): void {
      const lines: string[] = [];
      if (view.matches.length === 0) {
        lines.push(`  ${chalk.gray("no matching command")}`);
      }
      const height = Math.min(viewport, view.matches.length);
      for (let i = view.start; i < view.start + height; i++) {
        const item = view.matches[i];
        if (item === undefined) continue;
        const marker = i === view.cursor ? chalk.cyan("❯ ") : "  ";
        const label = `${item.usage}  ${item.description}`;
        lines.push(i === view.cursor ? `${marker}${chalk.bold(label)}` : `${marker}${label}`);
      }
      lines.push(
        chalk.gray(
          `  ${options.hint ?? "↑/↓ move · tab/enter select · esc dismiss"} · ${view.cursor + 1}/${view.matches.length}`,
        ),
      );
      drawnRows = lines.length;
      out.write(`\n${lines.map((line) => `\x1b[2K${line}`).join("\n")}`);
      // Park the cursor back on the prompt row; readline's own refresh will
      // reposition it inside the buffer on the next keypress.
      out.write(`\x1b[${drawnRows}A\r`);
    }

    const onKeypress = (
      _chunk: unknown,
      key: { name?: string; ctrl?: boolean; sequence?: string } | undefined,
    ): void => {
      const name = key?.name ?? "";
      if ((key?.ctrl && (name === "c" || name === "d")) || name === "escape") {
        return finish({ action: "dismiss", value: null, filter });
      }
      if (name === "backspace") {
        if (filter.length > 0) filter = filter.slice(0, -1);
        if (filter.length === 0 && dismissOnEmpty) {
          return finish({ action: "dismiss", value: null, filter });
        }
        return refresh();
      }
      if (name === "up" || (key?.ctrl && name === "p")) {
        const height = Math.min(viewport, view.matches.length);
        view.cursor = clampIndex(view.cursor - 1, view.matches.length);
        view.start = computeWindow(view.cursor, view.matches.length, height);
        return redraw();
      }
      if (name === "down" || (key?.ctrl && name === "n")) {
        const height = Math.min(viewport, view.matches.length);
        view.cursor = clampIndex(view.cursor + 1, view.matches.length);
        view.start = computeWindow(view.cursor, view.matches.length, height);
        return redraw();
      }
      if (name === "return" || name === "enter" || name === "tab") {
        const picked = view.matches[view.cursor];
        if (picked === undefined) return finish({ action: "dismiss", value: null, filter });
        return finish({ action: "select", value: picked.value, filter });
      }
      const text = key?.sequence ?? "";
      if (text.length === 1 && text >= " ") {
        filter += text;
        return refresh();
      }
    };

    input.on("keypress", onKeypress);
  });
}

function clampIndex(index: number, length: number): number {
  if (length === 0) return 0;
  if (index < 0) return 0;
  if (index > length - 1) return length - 1;
  return index;
}

/** Slide the scroll window only when the cursor would leave it. */
function computeWindow(cursor: number, length: number, height: number): number {
  if (length <= height) return 0;
  let start = cursor - height + 1;
  if (start < 0) start = 0;
  return Math.min(start, length - height);
}
