/**
 * DOM-pass regression (issue #136 follow-up): attachHtmlPreviews must run
 * `pre.replaceWith(wrapper)` BEFORE appending the pre into the wrapper.
 * Appending first makes the replace a hierarchy cycle — the new node would
 * contain the element being replaced — which real browsers reject with
 * HierarchyRequestError, detaching the code block and leaving an empty
 * markdown body (caught in a real headless-Chromium session).
 *
 * The repo's vitest env is `node` (no DOM library), so this test ships a
 * minimal DOM stub whose `replaceWith` ENFORCES the browser contract. If
 * the attach pass regresses to the broken order, the stub throws the same
 * error a browser would.
 */

import { describe, it, expect } from "vitest";
import { attachHtmlPreviews } from "../client/lib/preview.js";

interface StubElement {
  tagName: string;
  parentNode: StubElement | null;
  readonly parentElement: StubElement | null;
  children: StubElement[];
  attrs: Record<string, string>;
  listeners: Record<string, () => void>;
  textContent: string;
  hidden: boolean;
  srcdoc: string;
  ownerDocument: unknown;
  className: string;
  append(...nodes: StubElement[]): void;
  appendChild(node: StubElement): StubElement;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  addEventListener(type: string, fn: () => void): void;
  replaceWith(replacement: StubElement): void;
  closest(selector: string): StubElement | null;
  querySelectorAll(selector: string): StubElement[];
}

interface StubDocument {
  createElement(tag: string): StubElement;
}

/** Minimal element with real parentage and a browser-faithful replaceWith. */
function makeElement(tag: string, doc: StubDocument): StubElement {
  const el: StubElement = {
    tagName: tag,
    parentNode: null,
    parentElement: null,
    children: [],
    attrs: {},
    listeners: {},
    textContent: "",
    hidden: false,
    srcdoc: "",
    ownerDocument: doc,
    className: "",
    append(...nodes: StubElement[]) {
      for (const node of nodes) {
        node.parentNode = el;
        el.children.push(node);
      }
    },
    appendChild(node: StubElement) {
      node.parentNode = el;
      el.children.push(node);
      return node;
    },
    setAttribute(name: string, value: string) {
      el.attrs[name] = value;
    },
    getAttribute(name: string) {
      return el.attrs[name] ?? null;
    },
    addEventListener(type: string, fn: () => void) {
      el.listeners[type] = fn;
    },
    replaceWith(replacement: StubElement) {
      const parent = el.parentNode;
      // The browser contract: the replacement must not contain the node
      // being replaced (DOM Standard — replaceWith pre-insert validity).
      let cursor: StubElement | null = replacement;
      while (cursor !== null) {
        if (cursor === el) {
          throw new Error(
            "Failed to execute 'replaceWith' on 'Element': The new child element contains the parent.",
          );
        }
        cursor = cursor.parentNode;
      }
      if (parent) {
        const index = parent.children.indexOf(el);
        if (index >= 0) parent.children.splice(index, 1, replacement);
        el.parentNode = null;
        replacement.parentNode = parent;
      }
    },
    closest(selector: string) {
      for (let cursor: StubElement | null = el; cursor; cursor = cursor.parentNode) {
        if (selector === "[data-tau-preview]" && cursor.attrs["data-tau-preview"]) return cursor;
      }
      return null;
    },
    querySelectorAll(selector: string) {
      const out: StubElement[] = [];
      const visit = (node: StubElement): void => {
        for (const child of node.children) {
          if (selector === 'pre > code[data-lang="html"]') {
            if (
              child.tagName === "code" &&
              child.attrs["data-lang"] === "html" &&
              child.parentNode?.tagName === "pre"
            ) {
              out.push(child);
            }
          }
          visit(child);
        }
      };
      visit(el);
      return out;
    },
  };
  Object.defineProperty(el, "parentElement", {
    get(): StubElement | null {
      return el.parentNode;
    },
  });
  return el;
}

function makeDoc(): { doc: { createElement(tag: string): StubElement } } {
  const doc = {
    createElement(tag: string) {
      return makeElement(tag, doc);
    },
  };
  return { doc };
}

/** A root holding one markdown-rendered html fence: pre > code[data-lang]. */
function makeRootWithFence(): { root: StubElement; pre: StubElement; code: StubElement } {
  const { doc } = makeDoc();
  const root = makeElement("div", doc);
  const pre = makeElement("pre", doc);
  const code = makeElement("code", doc);
  code.attrs["data-lang"] = "html";
  code.textContent = "<h1>hi</h1>";
  pre.appendChild(code);
  root.appendChild(pre);
  return { root, pre, code };
}

function isDescendant(root: StubElement, node: StubElement): boolean {
  for (const child of root.children) {
    if (child === node || isDescendant(child, node)) return true;
  }
  return false;
}

describe("attachHtmlPreviews — browser replaceWith hierarchy contract", () => {
  it("keeps the code block attached to the document after wrapping", () => {
    const { root, pre } = makeRootWithFence();
    const added = attachHtmlPreviews(root as unknown as ParentNode);
    expect(added).toBe(1);
    expect(root.children).toHaveLength(1);
    expect(isDescendant(root, pre)).toBe(true);
    expect(pre.parentNode?.attrs["data-tau-preview"]).toBe("1");
  });

  it("wraps the pre in a [data-tau-preview] shell with a preview toggle", () => {
    const { root, pre } = makeRootWithFence();
    attachHtmlPreviews(root as unknown as ParentNode);
    const wrapper = root.children[0]!;
    expect(wrapper.attrs["data-tau-preview"]).toBe("1");
    const head = wrapper.children.find((c) => c.className === "hp-head");
    const toggle = head?.children.find((c) => c.className === "hp-toggle");
    expect(toggle?.textContent).toBe("preview");
    // the pre was MOVED into the wrapper (not cloned, not left detached)
    expect(wrapper.children.some((c) => c.tagName === "pre")).toBe(true);
    expect(pre.parentNode).toBe(wrapper);
  });

  it("is idempotent — already-wrapped blocks are skipped", () => {
    const { root } = makeRootWithFence();
    attachHtmlPreviews(root as unknown as ParentNode);
    expect(attachHtmlPreviews(root as unknown as ParentNode)).toBe(0);
  });
});
