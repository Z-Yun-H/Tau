/**
 * @tau/markdown — shared markdown rendering for Tau front doors.
 *
 * Two renderers, one contract each:
 * - `renderMarkdown` (html.ts): escape-first Markdown → HTML for the WebUI.
 *   Security property: input is HTML-escaped FIRST; only whitelisted tags are
 *   ever emitted; links are http(s)-only with rel=noopener.
 * - `renderToAnsi` (ansi.ts): Markdown → ANSI for the TUI, parsed with
 *   `marked`, styles injectable via AnsiTheme, terminal-escape sanitized.
 */

export { escapeHtml, renderMarkdown } from "./html.js";
export { defaultAnsiTheme, displayWidth, renderToAnsi, stripTerminalEscapes } from "./ansi.js";
export type { AnsiOptions, AnsiTheme } from "./ansi.js";
