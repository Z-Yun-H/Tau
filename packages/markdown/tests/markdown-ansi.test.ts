import { describe, expect, it } from "vitest";
import { displayWidth, renderToAnsi, stripTerminalEscapes, type AnsiTheme } from "../src/ansi.js";

// Control characters built at runtime — never embedded as raw/escaped bytes
// in source (they do not survive text pipelines reliably).
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

// Identity theme → structure assertions without ANSI noise. Styles themselves
// are exercised by the default-theme smoke test at the bottom.
const identity: AnsiTheme = {
  heading: (text) => `H<${text}>`,
  strong: (text) => `B<${text}>`,
  em: (text) => `I<${text}>`,
  codespan: (text) => `C<${text}>`,
  del: (text) => `D<${text}>`,
  link: (text, href) => `L<${text}|${href}>`,
  codeBlock: (text) => text,
  codeRule: (text) => text,
  quote: (text) => `Q<${text}>`,
  bullet: (text) => text,
  hr: (text) => text,
  tableBorder: (text) => text,
  muted: (text) => text,
};

const render = (md: string, width = 80): string => renderToAnsi(md, { theme: identity, width });

describe("stripTerminalEscapes", () => {
  it("removes CSI and OSC sequences", () => {
    const dirty = `a${ESC}[31mred${ESC}[0m${ESC}]0;title${BEL}b`;
    expect(stripTerminalEscapes(dirty)).toBe("aredb");
  });

  it("drops C0 control characters but keeps newline", () => {
    const dirty = `x${String.fromCharCode(0)}${BEL}${String.fromCharCode(8)}y\nz`;
    expect(stripTerminalEscapes(dirty)).toBe("xy\nz");
  });
});

describe("displayWidth", () => {
  it("counts wide CJK code points as two columns", () => {
    expect(displayWidth("tau")).toBe(3);
    expect(displayWidth("终端")).toBe(4);
    expect(displayWidth("tau终端")).toBe(7);
  });

  it("ignores ANSI sequences and control characters", () => {
    expect(displayWidth(`${ESC}[1mab${ESC}[0m`)).toBe(2);
  });
});

describe("renderToAnsi — blocks", () => {
  it("renders headings with their inline markup", () => {
    expect(render("# Title")).toBe("H<Title>");
    expect(render("## sub **bold**")).toBe("H<sub B<bold>>");
  });

  it("renders paragraphs with inline styles", () => {
    expect(render("run `tau ask` **now**")).toBe("run C<tau ask> B<now>");
  });

  it("renders fenced code with a language rule", () => {
    const out = render("```ts\nlet x = 1;\nlet y = 2;\n```");
    expect(out.split("\n")).toEqual(["── ts ──", "  let x = 1;", "  let y = 2;", "────────"]);
  });

  it("renders unordered, ordered and task lists", () => {
    expect(render("- a\n- b")).toBe("• a\n• b");
    expect(render("1. one\n2. two")).toBe("1. one\n2. two");
    expect(render("- [x] done\n- [ ] todo")).toBe("☑ done\n☐ todo");
  });

  it("indents nested list levels", () => {
    const out = render("- a\n  - b");
    expect(out.split("\n")[0]).toBe("• a");
    expect(out.split("\n")[1]).toBe("  • b");
  });

  it("prefixes blockquote lines", () => {
    expect(render("> quoted **text**")).toBe("Q<│ >quoted B<text>");
  });

  it("renders an hr sized to the width", () => {
    expect(render("---", 20)).toBe("─".repeat(20));
  });
});

describe("renderToAnsi — tables and wrapping", () => {
  it("aligns table columns including CJK widths", () => {
    const md = "| tool | 风险 |\n| --- | --- |\n| file.find | 低 |\n| text.hash | low |";
    const rows = render(md, 60).split("\n");
    expect(rows.length).toBe(6); // border / header / border / 2 body rows / border
    expect(new Set(rows.map((r) => displayWidth(r))).size).toBe(1);
  });

  it("hard-wraps long paragraphs at the width", () => {
    const out = render("aaaa bbbb cccc dddd", 10);
    const lines = out.split("\n");
    expect(lines.length).toBe(2);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(10);
  });

  it("breaks CJK runs anywhere when wrapping", () => {
    const out = render("终端助手终端助手终端助手终端助手", 8);
    for (const line of out.split("\n")) {
      expect(displayWidth(line)).toBeLessThanOrEqual(8);
    }
  });
});

describe("renderToAnsi — safety", () => {
  it("renders raw HTML as inert muted text", () => {
    const out = render('<img src=x onerror="alert(1)">\n\n<div>block</div>');
    // the terminal never parses HTML — the literal markup is inert text here
    expect(out).toContain('<img src=x onerror="alert(1)">');
    expect(out).toContain("<div>block</div>");
  });

  it("strips terminal escape injection from the source", () => {
    const out = render(`safe${ESC}]0;pwned${BEL}text`);
    expect(out).toContain("safetext");
    expect(out).not.toContain(ESC);
  });

  it("renders images as muted placeholders", () => {
    expect(render("![alt](https://x/y.png)")).toContain("[image: alt]");
  });
});

describe("renderToAnsi — default theme", () => {
  it("emits real ANSI styling even without a TTY", () => {
    const out = renderToAnsi("# Title\n\n`code` and [x](https://e.com)");
    expect(out).toContain(`${ESC}[1m`); // bold heading styles
    expect(out).toContain(`${ESC}[36m`); // cyan codespan / link text
    expect(out).toContain("(https://e.com)");
  });
});
