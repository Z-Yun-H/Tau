/**
 * Minimal, dependency-free Markdown renderer for the WebUI preview surfaces
 * (plan explanations and result output). Golden rule 4: no new runtime
 * dependencies — this is ~130 lines instead of a parser package.
 *
 * Contract: string in → HTML string out, DOM-free (tests run in plain node)
 * and injection-safe. The input is HTML-escaped FIRST, so every inline rule
 * below operates on escaped text and the only tags ever emitted are the
 * ones this file writes itself.
 *
 * Block: #–###### headings, ``` fences, --- hr, > blockquote, - / * lists,
 * 1. lists, paragraphs. Inline: `code`, **bold**, *italic*,
 * [text](http(s)://url) — external links only, always rel=noopener.
 */

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(input: string): string {
  return input.replace(/[&<>"']/g, (ch) => ESCAPES[ch] ?? ch);
}

/** Inline markup over already-escaped text; code spans are tokenized first. */
function renderInline(text: string): string {
  // Private-use sentinels: escapeHtml passes them through untouched, and no
  // realistic input produces them, so token/restore collisions are a non-issue.
  const OPEN = "\uE000";
  const CLOSE = "\uE001";
  const codes: string[] = [];
  let out = text.replace(/`([^`]+)`/g, (_, code: string) => {
    codes.push(code);
    return `${OPEN}${codes.length - 1}${CLOSE}`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  return out.replace(/\uE000(\d+)\uE001/g, (_, index: string) => {
    const code = codes[Number(index)] ?? "";
    return `<code>${code}</code>`;
  });
}

function renderList(lines: string[], start: number, ordered: boolean): [string, number] {
  const pattern = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*]\s+(.*)$/;
  const items: string[] = [];
  let i = start;
  while (i < lines.length) {
    const match = (lines[i] ?? "").match(pattern);
    if (!match) break;
    items.push(`<li>${renderInline(match[1] ?? "")}</li>`);
    i++;
  }
  return [ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`, i];
}

export function renderMarkdown(source: string): string {
  const lines = escapeHtml(source).replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // Fenced code block — content stays pre-escaped, language label dropped.
    const fence = line.match(/^```[\w-]*\s*$/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? "")) {
        body.push(lines[i] ?? "");
        i++;
      }
      i++; // skip the closing fence (or run past EOF)
      out.push(`<pre><code>${body.join("\n")}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = (heading[1] ?? "#").length;
      out.push(`<h${level}>${renderInline(heading[2] ?? "")}</h${level}>`);
      i++;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }

    if (/^&gt;\s?/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^&gt;\s?/.test(lines[i] ?? "")) {
        quoted.push((lines[i] ?? "").replace(/^&gt;\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${renderInline(quoted.join("\n"))}</blockquote>`);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const [html, next] = renderList(lines, i, false);
      out.push(html);
      i = next;
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const [html, next] = renderList(lines, i, true);
      out.push(html);
      i = next;
      continue;
    }

    // Paragraph: consecutive plain lines, hard-wrapped so terminal-style
    // output keeps its line structure in the preview.
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i] ?? "") &&
      !/^(```|#{1,6}\s|&gt;|\s*[-*]\s|\s*\d+[.)]\s)/.test(lines[i] ?? "")
    ) {
      paragraph.push(lines[i] ?? "");
      i++;
    }
    out.push(`<p>${renderInline(paragraph.join("\n"))}</p>`);
  }
  return out.join("\n");
}
