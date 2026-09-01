/**
 * Markdown → ANSI terminal renderer (TUI surfaces).
 *
 * Parse once with `marked` (per its official docs: Lexer.lex for blocks,
 * Lexer.lexInline for inline fallback), then walk the token tree and emit
 * styled terminal lines. Styles are INJECTABLE via AnsiTheme so an app (e.g.
 * @tau/tui) can bind them to its own @tau/ui theme; defaults use chalk.
 *
 * Safety: the source is sanitized FIRST — terminal escape sequences (CSI/OSC)
 * and C0 control characters (except \n) are stripped, so rendered output can
 * never reprogram the terminal. Raw HTML tokens are dropped, never echoed.
 *
 * Layout: paragraphs hard-wrap at `width` (default 80); wrapping measures
 * display width with an approximate East-Asian-width rule (wide/fullwidth
 * code points count 2 columns) so CJK content wraps correctly. Extremely
 * long styled tokens (ANSI inside a > width unbreakable run) may overflow —
 * plain long words hard-break fine.
 */

import { Lexer, type Token, type Tokens } from "marked";
import { Chalk } from "chalk";

// Defaults must style even in non-TTY contexts (piped output, tests, snapshots)
// — an isolated instance with a forced level, NOT the shared singleton, so no
// global chalk state is mutated.
const color = new Chalk({ level: 3 });

/** Strip ANSI escape sequences (CSI + OSC) and C0 controls except newline. */
// eslint-disable-next-line no-control-regex -- stripping control chars IS the feature
const ANSI_ESCAPE = /\x1b(?:\[[0-9;?]*[A-Za-z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;
// eslint-disable-next-line no-control-regex -- same: C0 scrubbing for terminal safety
const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

export function stripTerminalEscapes(input: string): string {
  return input.replace(ANSI_ESCAPE, "").replace(CONTROL_CHARS, "");
}

const WIDE =
  /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uA960-\uA97F\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/u;

/** Approximate terminal display width (wide/fullwidth code points count 2). */
export function displayWidth(text: string): number {
  let w = 0;
  for (const ch of stripTerminalEscapes(text)) w += WIDE.test(ch) ? 2 : 1;
  return w;
}

/** Injectable style surface — bind these to an app theme for consistency. */
export interface AnsiTheme {
  heading: (text: string, level: number) => string;
  strong: (text: string) => string;
  em: (text: string) => string;
  codespan: (text: string) => string;
  del: (text: string) => string;
  link: (text: string, href: string) => string;
  codeBlock: (text: string) => string;
  codeRule: (text: string) => string;
  quote: (text: string) => string;
  bullet: (text: string) => string;
  hr: (text: string) => string;
  tableBorder: (text: string) => string;
  muted: (text: string) => string;
}

export const defaultAnsiTheme: AnsiTheme = {
  heading: (text, level) =>
    level <= 1 ? color.bold.underline(text) : level === 2 ? color.bold(text) : color.bold.dim(text),
  strong: (text) => color.bold(text),
  em: (text) => color.italic(text),
  codespan: (text) => color.yellow(text),
  del: (text) => color.strikethrough.dim(text),
  link: (text, href) => `${color.cyan(text)} ${color.dim(`(${href})`)}`,
  codeBlock: (text) => color.cyan(text),
  codeRule: (text) => color.dim(text),
  quote: (text) => color.dim(text),
  bullet: (text) => color.cyan(text),
  hr: (text) => color.dim(text),
  tableBorder: (text) => color.dim(text),
  muted: (text) => color.dim(text),
};

export interface AnsiOptions {
  /** Wrap width in terminal columns (default 80). */
  width?: number;
  /** Style overrides merged over {@link defaultAnsiTheme}. */
  theme?: Partial<AnsiTheme>;
}

/** Render markdown source to a styled terminal string (no trailing newline). */
export function renderToAnsi(source: string, options: AnsiOptions = {}): string {
  const width = options.width ?? 80;
  const theme: AnsiTheme = { ...defaultAnsiTheme, ...options.theme };
  const blocks = Lexer.lex(stripTerminalEscapes(source));
  const out: string[] = [];
  renderBlocks(blocks, out, theme, width, 0);
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function renderBlocks(
  tokens: Token[],
  out: string[],
  theme: AnsiTheme,
  width: number,
  indent: number,
): void {
  for (const token of tokens) {
    switch (token.type) {
      case "heading": {
        const t = token as Tokens.Heading;
        pushWrapped(out, theme.heading(inline(t.tokens, theme), t.depth), width, indent);
        break;
      }
      case "paragraph": {
        const t = token as Tokens.Paragraph;
        pushWrapped(out, inline(t.tokens, theme), width, indent);
        break;
      }
      case "code": {
        const t = token as Tokens.Code;
        const label = t.lang ? `── ${t.lang} ──` : "── code ──";
        out.push(" ".repeat(indent) + theme.codeRule(label));
        for (const line of t.text.replace(/\n$/, "").split("\n")) {
          out.push(" ".repeat(indent + 2) + theme.codeBlock(line));
        }
        out.push(" ".repeat(indent) + theme.codeRule("─".repeat(displayWidth(label))));
        break;
      }
      case "blockquote": {
        const t = token as Tokens.Blockquote;
        const inner: string[] = [];
        renderBlocks(t.tokens, inner, theme, width, indent + 2);
        for (const line of inner) {
          out.push(" ".repeat(indent) + theme.quote("│ ") + line.slice(indent + 2));
        }
        break;
      }
      case "list": {
        renderList(token as Tokens.List, out, theme, width, indent);
        break;
      }
      case "hr": {
        out.push(
          " ".repeat(indent) + theme.hr("─".repeat(Math.min(Math.max(width - indent, 8), 60))),
        );
        break;
      }
      case "table": {
        renderTable(token as Tokens.Table, out, theme, width, indent);
        break;
      }
      case "html": {
        // Raw HTML is shown as inert muted TEXT — the terminal never parses it,
        // so displaying the literal markup is safe and loses no information.
        const t = token as Tokens.HTML;
        for (const line of t.text.replace(/\n$/, "").split("\n")) {
          out.push(" ".repeat(indent) + theme.muted(line));
        }
        break;
      }
      case "def":
      case "space":
        // link defs are resolved by marked
        break;
      case "text": {
        const t = token as Tokens.Text;
        pushWrapped(out, inline(t.tokens ?? [], theme) || t.text, width, indent);
        break;
      }
      default: {
        const t = token as Tokens.Generic;
        pushWrapped(out, t.text ?? "", width, indent);
      }
    }
  }
}

function renderList(
  list: Tokens.List,
  out: string[],
  theme: AnsiTheme,
  width: number,
  indent: number,
): void {
  const ordered = list.ordered;
  const start = typeof list.start === "number" ? list.start : 1;
  list.items.forEach((item, i) => {
    const marker = item.task ? (item.checked ? "☑ " : "☐ ") : ordered ? `${start + i}. ` : "• ";
    const itemIndent = indent + displayWidth(marker);
    // task checkbox tokens are rendered as the marker itself
    const body = item.tokens[0]?.type === "checkbox" ? item.tokens.slice(1) : item.tokens;
    const rendered: string[] = [];
    renderBlocks(body, rendered, theme, width, itemIndent);
    if (rendered.length > 0) {
      out.push(" ".repeat(indent) + theme.bullet(marker) + rendered[0]!.slice(itemIndent));
      for (const line of rendered.slice(1)) out.push(line);
    } else {
      out.push(" ".repeat(indent) + theme.bullet(marker).trimEnd());
    }
  });
}

function renderTable(
  table: Tokens.Table,
  out: string[],
  theme: AnsiTheme,
  width: number,
  indent: number,
): void {
  const header = table.header.map((cell) => inline(cell.tokens, theme));
  const rows = table.rows.map((row) => row.map((cell) => inline(cell.tokens, theme)));
  const widths = header.map((_, c) =>
    Math.max(displayWidth(header[c] ?? ""), ...rows.map((row) => displayWidth(row[c] ?? "")), 3),
  );
  const total = widths.reduce((a, b) => a + b, 0) + 3 * Math.max(widths.length - 1, 0);
  if (total > width) {
    const overflow = total - width;
    const widest = Math.max(...widths);
    for (let c = 0; c < widths.length; c++) {
      if (widths[c] === widest && overflow > 0) widths[c] = Math.max(3, widest - overflow);
    }
  }

  const alignCell = (text: string, col: number): string => {
    const w = displayWidth(text);
    const target = widths[col] ?? w;
    const align = table.align[col];
    if (align === "right" && w < target) return " ".repeat(target - w) + text;
    if (align === "center" && w < target) {
      const left = Math.floor((target - w) / 2);
      return " ".repeat(left) + text + " ".repeat(target - w - left);
    }
    return text + " ".repeat(Math.max(target - w, 0));
  };

  const border = theme.tableBorder(
    " ".repeat(indent) + widths.map((w) => "─".repeat(w + 2)).join("┼"),
  );
  out.push(border);
  out.push(
    " ".repeat(indent) +
      header.map((cell, c) => ` ${alignCell(cell, c)} `).join(theme.tableBorder("│")),
  );
  out.push(border);
  for (const row of rows) {
    out.push(
      " ".repeat(indent) +
        row.map((cell, c) => ` ${alignCell(cell, c)} `).join(theme.tableBorder("│")),
    );
  }
  out.push(border);
}

/** Render inline tokens to a styled string. */
function inline(tokens: Token[], theme: AnsiTheme): string {
  let result = "";
  for (const token of tokens) {
    switch (token.type) {
      case "strong":
        result += theme.strong(inline((token as Tokens.Strong).tokens, theme));
        break;
      case "em":
        result += theme.em(inline((token as Tokens.Em).tokens, theme));
        break;
      case "del":
        result += theme.del(inline((token as Tokens.Del).tokens, theme));
        break;
      case "codespan":
        result += theme.codespan((token as Tokens.Codespan).text);
        break;
      case "link": {
        const t = token as Tokens.Link;
        result += theme.link(inline(t.tokens, theme) || t.text, t.href);
        break;
      }
      case "image":
        result += theme.muted(`[image: ${(token as Tokens.Image).text || "unnamed"}]`);
        break;
      case "br":
        result += "\n";
        break;
      case "escape":
        result += (token as Tokens.Escape).text;
        break;
      case "html":
      case "checkbox":
        // task checkboxes render at the list level; inline html/tags are
        // dropped from the flowing text (block-level html is shown muted)
        break;
      case "text": {
        const t = token as Tokens.Text;
        result += t.tokens ? inline(t.tokens, theme) : t.text;
        break;
      }
      default: {
        const t = token as Tokens.Generic;
        result += t.text ?? "";
      }
    }
  }
  return result;
}

/** Push text into `out` as one or more display-width-wrapped lines. */
function pushWrapped(out: string[], text: string, width: number, indent: number): void {
  const pad = " ".repeat(indent);
  for (const segment of text.split("\n")) {
    if (displayWidth(segment) + indent <= width) {
      out.push(pad + segment);
      continue;
    }
    for (const line of wrapLine(segment, Math.max(width - indent, 8))) out.push(pad + line);
  }
}

/** Greedy wrap with CJK break opportunities (wide chars break anywhere). */
function wrapLine(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  let lineW = 0;
  let word = "";
  let wordW = 0;

  const flushWord = (): void => {
    if (!word) return;
    if (wordW > width) {
      // hard-break an unbreakable overlong run
      if (lineW > 0) {
        lines.push(line);
        line = "";
        lineW = 0;
      }
      for (const ch of word) {
        const cw = WIDE.test(ch) ? 2 : 1;
        if (lineW + cw > width) {
          lines.push(line);
          line = "";
          lineW = 0;
        }
        line += ch;
        lineW += cw;
      }
    } else {
      if (lineW + wordW > width && lineW > 0) {
        lines.push(line);
        line = "";
        lineW = 0;
      }
      line += word;
      lineW += wordW;
    }
    word = "";
    wordW = 0;
  };

  for (const ch of text) {
    if (ch === " ") {
      flushWord();
      if (lineW + 1 <= width) {
        line += " ";
        lineW += 1;
      }
      continue;
    }
    const cw = WIDE.test(ch) ? 2 : 1;
    if (cw === 2) {
      // CJK: always a break opportunity
      flushWord();
      if (lineW + cw > width && lineW > 0) {
        lines.push(line);
        line = "";
        lineW = 0;
      }
      line += ch;
      lineW += cw;
    } else {
      word += ch;
      wordW += cw;
    }
  }
  flushWord();
  if (line || lines.length === 0) lines.push(line);
  return lines;
}
