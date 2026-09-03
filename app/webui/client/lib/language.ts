/**
 * Browser-safe file-name → language detection — a deliberate MIRROR of
 * `languageForFile` in packages/tools/src/file.ts (issue #109). The tools
 * module pulls node:fs, so the browser bundle cannot import it; this copy
 * keeps the exact same vocabulary and fallback rules. A vitest parity test
 * (webui/tests/language.test.ts) imports BOTH and fails on drift — one
 * vocabulary, two runtimes, one test.
 *
 * Values are shiki language ids (the file viewer's highlighter); unknown
 * names fall back to "text" — a wrong guess is worse than no highlighting.
 */

const EXTENSION_LANGUAGES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  py: "python",
  rb: "ruby",
  php: "php",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  cs: "csharp",
  sql: "sql",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  xml: "xml",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "less",
  md: "markdown",
  markdown: "markdown",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  vue: "vue",
  svelte: "svelte",
};

const EXACT_NAME_LANGUAGES: Record<string, string> = {
  dockerfile: "dockerfile",
  containerfile: "dockerfile",
  makefile: "makefile",
  gemfile: "ruby",
  rakefile: "ruby",
};

/**
 * Best-effort language id for a file name (shiki-compatible). The last
 * extension wins ("archive.tar.gz" → "gz" → text); dotfiles like .gitignore
 * have no extension; anything unknown is plain "text".
 */
export function languageForFile(name: string): string {
  const base = name.replaceAll("\\", "/").split("/").pop()?.toLowerCase() ?? "";
  const exact = EXACT_NAME_LANGUAGES[base];
  if (exact !== undefined) return exact;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "text"; // no extension, or a dotfile like .gitignore
  return EXTENSION_LANGUAGES[base.slice(dot + 1)] ?? "text";
}
