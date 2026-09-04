/**
 * Sandboxed HTML preview + binary file-view helpers (issue #136, generated-
 * content display). Pure logic first, DOM second:
 *
 * - {@link buildPreviewDoc} / {@link binaryViewKind} / file-mode helpers are
 *   pure and unit-tested in isolation (the vitest env is `node`).
 * - {@link attachHtmlPreviews} is the thin DOM pass over a rendered-markdown
 *   root, mirroring `highlight.ts`'s progressive-upgrade pattern: it wraps
 *   `html` fenced blocks in a shell with a preview/code toggle. The toggle
 *   swaps the highlighted code for an <iframe sandbox="allow-scripts"
 *   srcdoc=...> — NO allow-same-origin, so previewed content gets an opaque
 *   origin and can never touch the parent page, cookies or localStorage.
 *   This is a separate sandbox channel, NOT a relaxation of the escape-first
 *   markdown pipeline.
 */

/** True when the code is already a standalone document (pass verbatim). */
function isStandaloneDocument(code: string): boolean {
  return /^<!doctype\s+html/i.test(code) || /^<html[\s>]/i.test(code);
}

/**
 * The srcdoc payload for a previewed code block: full documents pass
 * through verbatim; fragments get a minimal shell with neutral base
 * styling so previews do not inherit layout surprises.
 */
export function buildPreviewDoc(code: string): string {
  const trimmed = code.trim();
  if (isStandaloneDocument(trimmed)) return trimmed;
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    "<style>html{margin:0;padding:8px;font-family:system-ui,sans-serif;}" +
    "img,video,canvas{max-width:100%;}</style></head><body>" +
    code +
    "</body></html>"
  );
}

/** What the ToolCallCard file viewer should do with a given path. */
export type BinaryViewKind = "pdf" | "image" | null;

/** Conservative extension sniffing — exactly the suffixes the server serves. */
export function binaryViewKind(filePath: string): BinaryViewKind {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "gif" || ext === "webp") {
    return "image";
  }
  return null;
}

/** The read-only route URL for a workspace file preview. */
export function filePreviewUrl(filePath: string): string {
  return `/api/file?path=${encodeURIComponent(filePath)}`;
}

/**
 * Wrap every `pre > code[data-lang="html"]` block under `root` in a
 * preview shell (header + toggle + hidden sandboxed iframe). Idempotent —
 * already-wrapped blocks are skipped, so streaming re-renders are cheap.
 * Runs BEFORE the shiki upgrade pass: the wrapped <pre> is still found and
 * replaced in place inside the shell. Returns the number of blocks wrapped.
 */
export function attachHtmlPreviews(root: ParentNode): number {
  const doc = root.ownerDocument ?? (root as Document);
  const codes = Array.from(root.querySelectorAll('pre > code[data-lang="html"]'));
  let added = 0;
  for (const code of codes) {
    const pre = code.parentElement;
    if (!pre || pre.closest("[data-tau-preview]")) continue;
    const source = code.textContent ?? "";
    if (!source.trim()) continue;

    const wrapper = doc.createElement("div");
    wrapper.className = "html-preview";
    wrapper.setAttribute("data-tau-preview", "1");

    const head = doc.createElement("div");
    head.className = "hp-head";
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "hp-toggle";
    button.textContent = "preview";
    const note = doc.createElement("span");
    note.className = "hp-note";
    note.textContent = "sandboxed — scripts run, page access denied";
    head.append(button, note);

    const body = doc.createElement("div");
    body.className = "hp-body";
    body.hidden = true;
    const frame = doc.createElement("iframe");
    frame.className = "hp-frame";
    frame.setAttribute("sandbox", "allow-scripts");
    frame.title = "sandboxed html preview";
    body.appendChild(frame);

    wrapper.append(head, body, pre);
    pre.replaceWith(wrapper);

    button.addEventListener("click", () => {
      const opening = body.hidden;
      if (opening && !frame.srcdoc) frame.srcdoc = buildPreviewDoc(source);
      body.hidden = !opening;
      button.textContent = opening ? "code" : "preview";
      wrapper.classList.toggle("previewing", opening === true);
    });
    added += 1;
  }
  return added;
}
