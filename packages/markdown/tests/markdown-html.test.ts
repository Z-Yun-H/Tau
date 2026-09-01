import { describe, expect, it } from "vitest";
import { escapeHtml, renderMarkdown } from "../src/html.js";

// Ported from app/webui/tests/markdown.test.ts (the renderer's original home)
// and extended. These tests ARE the security contract of the HTML renderer.

describe("escapeHtml", () => {
  it("escapes the five markup-significant characters", () => {
    expect(escapeHtml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&#39;");
  });
});

describe("renderMarkdown — blocks", () => {
  it("renders headings at their level with inline markup", () => {
    expect(renderMarkdown("## Plan **summary**")).toBe("<h2>Plan <strong>summary</strong></h2>");
  });

  it("keeps fenced code verbatim and escaped", () => {
    const md = '```ts\nconst s = "<b>&</b>";\n```';
    expect(renderMarkdown(md)).toBe(
      "<pre><code>const s = &quot;&lt;b&gt;&amp;&lt;/b&gt;&quot;;</code></pre>",
    );
  });

  it("renders unordered and ordered lists", () => {
    expect(renderMarkdown("- a\n- b")).toBe("<ul><li>a</li><li>b</li></ul>");
    expect(renderMarkdown("1. one\n2) two")).toBe("<ol><li>one</li><li>two</li></ol>");
  });

  it("renders blockquote and hr", () => {
    expect(renderMarkdown("> quoted")).toBe("<blockquote>quoted</blockquote>");
    expect(renderMarkdown("---")).toBe("<hr>");
  });

  it("hard-wraps consecutive plain lines into one paragraph", () => {
    expect(renderMarkdown("alpha\nbeta")).toBe("<p>alpha\nbeta</p>");
  });

  it("drops a trailing unclosed fence without throwing", () => {
    expect(renderMarkdown("```\ncode only")).toBe("<pre><code>code only</code></pre>");
  });
});

describe("renderMarkdown — inline", () => {
  it("renders code, bold, italic and emphasis precedence", () => {
    expect(renderMarkdown("run `tau ask` now")).toBe("<p>run <code>tau ask</code> now</p>");
    expect(renderMarkdown("**bold** and *em*")).toBe(
      "<p><strong>bold</strong> and <em>em</em></p>",
    );
  });

  it("keeps markup inside code spans literal", () => {
    expect(renderMarkdown("`**not bold**`")).toBe("<p><code>**not bold**</code></p>");
  });

  it("links only http(s) targets with rel=noopener", () => {
    const html = renderMarkdown("[docs](https://example.com/a)");
    expect(html).toBe(
      '<p><a href="https://example.com/a" target="_blank" rel="noopener noreferrer">docs</a></p>',
    );
    expect(renderMarkdown("[x](javascript:alert(1))")).not.toContain("<a ");
  });
});

describe("renderMarkdown — safety", () => {
  it("never lets raw markup through (XSS attempt)", () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("escapes html injection inside a fenced block", () => {
    const html = renderMarkdown("```\n<script>alert(1)</script>\n```");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});
