/**
 * Interactive UI primitives — arrow-key/j-k list selection with a scrolling
 * viewport (selectFromList) and hidden-input prompts (promptHidden).
 * Zero dependencies beyond chalk; streams are injectable for tests, and
 * non-TTY callers fall back to numbered answers instead of hanging.
 */

import readline from "node:readline";
import chalk from "chalk";

/**
 * Zero-dependency interactive selection (used by `tau provider use`).
 *
 * Two modes, decided by whether the input stream is a TTY:
 * - interactive: raw-mode arrow keys, enter to select, esc/q/Ctrl-C cancels;
 * - fallback (piped/CI): a numbered list plus one readline question.
 *
 * Streams are injectable so tests can drive both modes deterministically.
 */

const VIEWPORT = 12;

export interface PickerOptions {
  /** Heading printed above the list. */
  title: string;
  /** Choice labels (already formatted by the caller). */
  items: string[];
  /** Pre-selected index highlighted as "(current)", if any. */
  activeIndex?: number;
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

/** Ask the user to pick one of `items`. Resolves null on cancel/invalid input. */
export async function selectFromList(options: PickerOptions): Promise<number | null> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const isTTY = Boolean((input as NodeJS.ReadStream & { isTTY?: boolean }).isTTY);
  if (options.items.length === 0) return null;
  if (!isTTY) return selectByNumber(options, input, output);
  return selectByKeypress(options, input, output);
}

/* ---------------- fallback: numbered single question ---------------- */

function selectByNumber(
  options: PickerOptions,
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): Promise<number | null> {
  const { items } = options;
  const out = output as NodeJS.WriteStream;
  out.write(`${options.title}\n`);
  items.forEach((item, index) => {
    const current = index === options.activeIndex ? chalk.gray(" (current)") : "";
    out.write(`  ${String(index + 1).padStart(String(items.length).length)}) ${item}${current}\n`);
  });

  return new Promise((resolve) => {
    const rl = readline.createInterface({ input, output: out });
    const label = `Select [1-${items.length}], empty cancels: `;
    rl.question(label, (answer) => {
      rl.close();
      const trimmed = answer.trim();
      if (!/^\d+$/.test(trimmed)) {
        resolve(null);
        return;
      }
      const picked = Number(trimmed) - 1;
      resolve(picked >= 0 && picked < items.length ? picked : null);
    });
  });
}

/* ---------------- interactive: raw-mode keypress UI ---------------- */

function selectByKeypress(
  options: PickerOptions,
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
): Promise<number | null> {
  return new Promise((resolve) => {
    const out = output as NodeJS.WriteStream;
    const items = options.items;
    const height = Math.min(VIEWPORT, items.length);

    let cursor = clampIndex(options.activeIndex ?? 0, items.length);
    let start = computeWindow(cursor, items.length, height);

    out.write(`${options.title}\n`);
    render();

    let rawWasEnabled = false;
    type RawCapable = NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void };
    const rawInput = input as RawCapable;
    if (typeof rawInput.setRawMode === "function" && rawInput.isTTY) {
      rawWasEnabled = rawInput.isRaw === true;
      rawInput.setRawMode(true);
    }
    readline.emitKeypressEvents(input);

    const onKeypress = (
      _chunk: unknown,
      key: { name?: string; ctrl?: boolean; sequence?: string } | undefined,
    ): void => {
      const name = key?.name ?? "";
      if (key?.ctrl && name === "c") return finish(null);
      if (name === "up" || name === "k") {
        cursor = clampIndex(cursor - 1, items.length);
        start = computeWindow(cursor, items.length, height);
        redraw();
      } else if (name === "down" || name === "j") {
        cursor = clampIndex(cursor + 1, items.length);
        start = computeWindow(cursor, items.length, height);
        redraw();
      } else if (name === "return" || name === "enter" || name === "space") {
        finish(cursor);
      } else if (name === "escape" || name === "q") {
        finish(null);
      }
    };

    input.on("keypress", onKeypress);

    function finish(result: number | null): void {
      input.removeListener("keypress", onKeypress);
      if (typeof rawInput.setRawMode === "function" && rawInput.isTTY) {
        try {
          rawInput.setRawMode(rawWasEnabled);
        } catch {
          /* stream already closed */
        }
      }
      // Clear the list, keep the title, echo the outcome on its own line.
      out.write(`\x1b[${height + 1}A`);
      for (let i = 0; i < height + 1; i++) out.write("\x1b[2K\n");
      out.write(`\x1b[${height + 2}A`);
      out.write(
        result === null ? chalk.gray("cancelled.\n") : `${chalk.cyan(items[result] ?? "")}\n`,
      );
      resolve(result);
    }

    function render(): void {
      const lines: string[] = [];
      for (let i = start; i < start + height; i++) {
        const item = items[i] ?? "";
        if (i >= items.length) {
          lines.push("");
          continue;
        }
        const marker = i === cursor ? chalk.cyan("❯ ") : "  ";
        const suffix = i === options.activeIndex ? chalk.gray(" (current)") : "";
        lines.push(
          i === cursor ? `${marker}${chalk.bold(item)}${suffix}` : `${marker}${item}${suffix}`,
        );
      }
      lines.push(chalk.gray("  ↑/↓ move · enter select · esc cancel"));
      out.write(lines.map((line) => `\x1b[2K${line}`).join("\n") + "\n");
    }

    function redraw(): void {
      out.write(`\x1b[${height + 1}A`);
      render();
    }
  });
}

function clampIndex(index: number, length: number): number {
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

/**
 * Hidden prompt (API keys). Echoes `*` per character; Ctrl-C yields an empty
 * string. Outside a TTY it refuses loudly — callers should offer `--stdin`.
 */
export async function promptHidden(
  query: string,
  opts: { input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream } = {},
): Promise<string> {
  const input = (opts.input ?? process.stdin) as NodeJS.ReadStream;
  const output = (opts.output ?? process.stdout) as NodeJS.WriteStream;
  if (!input.isTTY) {
    throw new Error(
      "A terminal is required for hidden input — pass the key as an argument or pipe it with --stdin.",
    );
  }

  output.write(query);
  const rawWasEnabled = input.isRaw === true;
  input.setRawMode(true);
  readline.emitKeypressEvents(input);

  return new Promise((resolve) => {
    let secret = "";
    const onKeypress = (
      _chunk: unknown,
      key: { name?: string; ctrl?: boolean; sequence?: string } | undefined,
    ): void => {
      if (key?.ctrl && key.name === "c") return done();
      if (key?.name === "return" || key?.name === "enter") return done();
      if (key?.name === "backspace") {
        secret = secret.slice(0, -1);
        output.write("\b \b");
        return;
      }
      const text = key?.sequence ?? "";
      if (text.length === 1 && text >= " ") {
        secret += text;
        output.write("*");
      }
    };
    const onKeypressBound = onKeypress as (
      chunk: unknown,
      key: { name?: string; ctrl?: boolean; sequence?: string },
    ) => void;
    input.on("keypress", onKeypressBound);

    function done(): void {
      input.removeListener("keypress", onKeypressBound);
      try {
        input.setRawMode(rawWasEnabled);
      } catch {
        /* stream already closed */
      }
      output.write("\n");
      resolve(secret);
    }
  });
}
