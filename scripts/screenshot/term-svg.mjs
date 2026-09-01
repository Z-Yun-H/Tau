#!/usr/bin/env node
/**
 * term-svg.mjs — render a raw terminal capture (real pty bytes) into an SVG
 * screenshot.
 *
 * Zero dependencies. Feeds the capture through a minimal VT/xterm emulator
 * (SGR colors, cursor movement, line/display erase, carriage returns — the
 * escape subset Node CLIs and readline actually emit), then renders the final
 * screen state as an SVG image: text-based, diff-friendly, viewable on GitHub.
 *
 * Every text run carries `textLength`, so glyph columns stay pixel-aligned no
 * matter which monospace font the viewer resolves.
 *
 * Usage:
 *   node term-svg.mjs < capture.raw > shot.svg
 *   node term-svg.mjs capture.raw --title "tau --help" --min-cols 90
 *
 * Regeneration notes live in docs/screenshots/README.md of each app.
 */

import fs from "node:fs";

// ---- ANSI palette -----------------------------------------------------------

const BASIC = [
  "#3b4252",
  "#b04a4a",
  "#3f7d4e",
  "#8f6c2c",
  "#3d6b8f",
  "#7d5a9e",
  "#3d8484",
  "#c8cfda",
];
const BRIGHT = [
  "#5b6578",
  "#e06c75",
  "#5fae72",
  "#c99a3c",
  "#61afef",
  "#c678dd",
  "#56b6c2",
  "#eef2f7",
];

const hex = (n) => n.toString(16).padStart(2, "0");

function ansiColor(index) {
  if (index < 8) return BASIC[index];
  if (index < 16) return BRIGHT[index - 8];
  // xterm 256 palette: 6x6x6 cube then 24 grays.
  if (index < 232) {
    const i = index - 16;
    const step = [0, 95, 135, 175, 215, 255];
    const r = step[Math.floor(i / 36)];
    const g = step[Math.floor((i % 36) / 6)];
    const b = step[i % 6];
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  }
  const gray = 8 + (index - 232) * 10;
  return `#${hex(gray)}${hex(gray)}${hex(gray)}`;
}

const DEFAULT_FG = "#d6dce6";
const BG = "#0e1218";

// ---- minimal VT emulator ----------------------------------------------------

const WIDE =
  /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/;

function emptyCell() {
  return { ch: " ", style: "" };
}

function newScreen() {
  return {
    rows: [[]],
    row: 0,
    col: 0,
    fg: "",
    bg: "",
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    saved: null,
  };
}

function styleKey(s) {
  const parts = [];
  if (s.fg) parts.push(`f${s.fg}`);
  if (s.bg) parts.push(`b${s.bg}`);
  if (s.bold) parts.push("B");
  if (s.dim) parts.push("D");
  if (s.italic) parts.push("I");
  if (s.underline) parts.push("U");
  return parts.join(";");
}

function ensureRow(s, r) {
  while (s.rows.length <= r) s.rows.push([]);
  return s.rows[r];
}

function put(s, ch, width) {
  const row = ensureRow(s, s.row);
  while (row.length < s.col) row.push(emptyCell());
  row[s.col] = { ch, style: styleKey(s) };
  for (let i = 1; i < width; i++) row[s.col + i] = { ch: "", style: styleKey(s) };
  s.col += width;
}

function eraseLine(s, mode) {
  const row = ensureRow(s, s.row);
  const clear = (from, to) => {
    for (let c = from; c <= to; c++) row[c] = emptyCell();
  };
  const last = Math.max(row.length - 1, s.col);
  if (mode === 0) clear(s.col, last);
  else if (mode === 1) clear(0, Math.min(s.col, last));
  else clear(0, last);
}

function eraseDisplay(s, mode) {
  if (mode === 2) {
    s.rows = [[]];
    ensureRow(s, s.row);
  } else if (mode === 0) {
    eraseLine(s, 0);
    s.rows = s.rows.slice(0, s.row + 1);
  } else if (mode === 1) {
    eraseLine(s, 1);
    for (let r = 0; r < s.row; r++) s.rows[r] = [];
  }
}

function csi(s, params, privates, final) {
  const nums = params.map((p) => (p === "" ? 0 : parseInt(p, 10) || 0));
  const n = nums.length ? nums[0] : 0;
  if (privates) return; // ?25h cursor hide, ?2004h bracketed paste, ... — ignore
  switch (final) {
    case "A":
      s.row = Math.max(0, s.row - Math.max(n, 1));
      break;
    case "B":
      s.row += Math.max(n, 1);
      ensureRow(s, s.row);
      break;
    case "C":
      s.col += Math.max(n, 1);
      break;
    case "D":
      s.col = Math.max(0, s.col - Math.max(n, 1));
      break;
    case "G":
      s.col = Math.max(0, n - 1);
      break;
    case "d":
      s.row = Math.max(0, n - 1);
      ensureRow(s, s.row);
      break;
    case "H":
    case "f": {
      s.row = Math.max(0, (nums[0] || 1) - 1);
      s.col = Math.max(0, (nums[1] || 1) - 1);
      ensureRow(s, s.row);
      break;
    }
    case "J":
      eraseDisplay(s, n);
      break;
    case "K":
      eraseLine(s, n);
      break;
    case "s":
      s.saved = { row: s.row, col: s.col };
      break;
    case "u":
      if (s.saved) {
        s.row = s.saved.row;
        s.col = s.saved.col;
      }
      break;
    case "m":
      sgr(s, nums);
      break;
    default:
      break; // scroll regions etc. — not needed for CLI/readline captures
  }
}

function sgr(s, nums) {
  if (nums.length === 0) nums = [0];
  for (let i = 0; i < nums.length; i++) {
    const p = nums[i];
    if (p === 0) {
      s.fg = s.bg = "";
      s.bold = s.dim = s.italic = s.underline = false;
    } else if (p === 1) s.bold = true;
    else if (p === 2) s.dim = true;
    else if (p === 3) s.italic = true;
    else if (p === 4) s.underline = true;
    else if (p === 22) s.bold = s.dim = false;
    else if (p === 23) s.italic = false;
    else if (p === 24) s.underline = false;
    else if (p >= 30 && p <= 37) s.fg = ansiColor(p - 30);
    else if (p === 39) s.fg = "";
    else if (p >= 40 && p <= 47) s.bg = ansiColor(p - 40);
    else if (p === 49) s.bg = "";
    else if (p >= 90 && p <= 97) s.fg = ansiColor(p - 90 + 8);
    else if (p >= 100 && p <= 107) s.bg = ansiColor(p - 100 + 8);
    else if ((p === 38 || p === 48) && nums[i + 1] === 5) {
      const color = ansiColor(nums[i + 2] ?? 0);
      if (p === 38) s.fg = color;
      else s.bg = color;
      i += 2;
    } else if ((p === 38 || p === 48) && nums[i + 1] === 2) {
      const color = `#${hex(nums[i + 2] ?? 0)}${hex(nums[i + 3] ?? 0)}${hex(nums[i + 4] ?? 0)}`;
      if (p === 38) s.fg = color;
      else s.bg = color;
      i += 4;
    }
  }
}

/** Feed a raw pty capture; returns the emulated final screen. */
export function emulate(raw) {
  // util-linux `script` logs its own start/done banners into the typescript —
  // they are capture-tool artifacts, not app output; drop them.
  raw = raw.replace(/^Script started on .*\r?\n?/m, "").replace(/^Script done on .*\r?\n?/m, "");
  const s = newScreen();
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (ch === "\x1b") {
      const next = raw[i + 1];
      if (next === "[") {
        let j = i + 2;
        let params = "";
        let privates = false;
        if (raw[j] === "?") {
          privates = true;
          j++;
        }
        while (j < raw.length && /[\d;]/.test(raw[j])) params += raw[j++];
        const final = raw[j];
        if (final === undefined) break;
        csi(s, params.split(";"), privates, final);
        i = j + 1;
      } else if (next === "7") {
        s.saved = { row: s.row, col: s.col };
        i += 2;
      } else if (next === "8") {
        if (s.saved) {
          s.row = s.saved.row;
          s.col = s.saved.col;
        }
        i += 2;
      } else if (next === "(" || next === ")") {
        i += 3; // charset designation — consume and ignore
      } else {
        i += 2; // OSC and other two-byte escapes — ignore
      }
    } else if (ch === "\r") {
      s.col = 0;
      i++;
    } else if (ch === "\n") {
      s.row++;
      ensureRow(s, s.row);
      i++;
    } else if (ch === "\t") {
      s.col += 8 - (s.col % 8);
      i++;
    } else if (ch === "\b") {
      s.col = Math.max(0, s.col - 1);
      i++;
    } else if (ch === "\x07" || ch === "\x00") {
      i++;
    } else {
      // Full code point (handles surrogate pairs / multibyte input).
      const point = String.fromCodePoint(raw.codePointAt(i));
      const width = WIDE.test(point) ? 2 : 1;
      put(s, point, width);
      i += point.length;
    }
  }
  return s;
}

// ---- SVG rendering ----------------------------------------------------------

const esc = (text) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/**
 * Render the screen to SVG. `textLength` pins each run to the exact
 * column grid, so alignment survives any monospace font the viewer picks.
 */
export function renderSvg(screen, options = {}) {
  const charW = options.charWidth ?? 7.85;
  const lineH = options.lineHeight ?? 19;
  const fontSize = options.fontSize ?? 13;
  const pad = options.padding ?? 16;
  const minCols = options.minCols ?? 0;
  const title = options.title ?? "";

  // Crop trailing empty rows; measure the widest content column.
  const rows = [...screen.rows];
  while (rows.length > 1 && rows[rows.length - 1].every((c) => !c || c.ch === " ")) rows.pop();
  while (rows.length > 1 && rows[0].every((c) => !c || c.ch === " ")) rows.shift();
  let cols = minCols;
  for (const row of rows) {
    let last = row.length;
    while (last > 0 && (!row[last - 1] || row[last - 1].ch === " ")) last--;
    cols = Math.max(cols, last);
  }

  const barH = title ? 34 : 0;
  const width = Math.ceil(cols * charW + pad * 2);
  const height = Math.ceil(rows.length * lineH + pad * 2 + barH);

  const out = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
      `viewBox="0 0 ${width} ${height}" font-family="ui-monospace, 'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace" ` +
      `font-size="${fontSize}">`,
  );
  out.push(
    `<rect width="${width}" height="${height}" rx="10" fill="#0e1218"/>` +
      `<rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="9" fill="none" stroke="#2a3140" stroke-width="1"/>`,
  );
  if (title) {
    out.push(
      `<text x="${pad}" y="${barH / 2 + 5}" fill="#8b95a7" xml:space="preserve" textLength="${Math.ceil(title.length * charW)}" lengthAdjust="spacing">${esc(title)}</text>` +
        `<line x1="0" y1="${barH}" x2="${width}" y2="${barH}" stroke="#2a3140" stroke-width="1"/>`,
    );
  }

  let y = pad + barH + fontSize;
  for (const row of rows) {
    // Group consecutive cells sharing one style into runs.
    let x = pad;
    let c = 0;
    while (c < row.length) {
      const cell = row[c];
      if (!cell || cell.ch === "" || (cell.ch === " " && !cell.style)) {
        c++;
        continue;
      }
      let end = c + 1;
      while (end < row.length && row[end] && row[end].style === cell.style) end++;
      const text = row
        .slice(c, end)
        .map((k) => k.ch)
        .join("")
        .replace(/ +$/, "");
      // Visual width of the emitted text: wide (CJK) glyphs span two columns,
      // so textLength must sum glyph widths, not count characters.
      const textCols = [...text].reduce((sum, k) => sum + (WIDE.test(k) ? 2 : 1), 0);
      const runCols = end - c;
      const style = cell.style || "";
      const fg = style.match(/f([^;B-DU]+)/)?.[1] ?? DEFAULT_FG;
      const bg = style.match(/b([^;B-DU]+)/)?.[1] ?? "";
      const attrs = [`fill="${fg}"`, 'xml:space="preserve"'];
      if (style.includes("B")) attrs.push('font-weight="700"');
      if (style.includes("D")) attrs.push('fill-opacity="0.62"');
      if (style.includes("I")) attrs.push('font-style="italic"');
      if (style.includes("U")) attrs.push('text-decoration="underline"');
      if (bg) {
        out.push(
          `<rect x="${x}" y="${y - fontSize + 2}" width="${runCols * charW}" height="${lineH}" fill="${bg}"/>`,
        );
      }
      out.push(
        `<text x="${x}" y="${y}" ${attrs.join(" ")} textLength="${Math.ceil(textCols * charW)}" lengthAdjust="spacing">${esc(text)}</text>`,
      );
      x += runCols * charW;
      c = end;
    }
    y += lineH;
  }
  out.push("</svg>");
  return out.join("\n");
}

// ---- CLI --------------------------------------------------------------------

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--title") options.title = argv[++i] ?? "";
    else if (argv[i] === "--min-cols") options.minCols = parseInt(argv[++i], 10) || 0;
    else if (argv[i] === "--char-width") options.charWidth = parseFloat(argv[++i]) || 7.85;
    else options.file = argv[i];
  }
  return options;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs(process.argv.slice(2));
  const raw = options.file ? fs.readFileSync(options.file, "utf8") : fs.readFileSync(0, "utf8");
  process.stdout.write(renderSvg(emulate(raw), options) + "\n");
}
