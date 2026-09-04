/**
 * Client preview pure logic (issue #136): the srcdoc builder for sandboxed
 * html previews (verbatim documents vs the fragment shell) and the binary
 * file-view kind sniffing. The DOM-attaching pass (attachHtmlPreviews) is
 * exercised by the built client in the snapshot/e2e flow; these pure parts
 * run in the node vitest env.
 */

import { describe, it, expect } from "vitest";
import { binaryViewKind, buildPreviewDoc, filePreviewUrl } from "../client/lib/preview.js";

describe("buildPreviewDoc", () => {
  it("passes standalone html documents through verbatim", () => {
    const doc = "<!doctype html><html><body><h1>hi</h1></body></html>";
    expect(buildPreviewDoc(doc)).toBe(doc);
    const bare = '<html lang="en"><body>x</body></html>';
    expect(buildPreviewDoc(bare)).toBe(bare);
  });

  it("wraps fragments in a minimal neutral shell", () => {
    const out = buildPreviewDoc("<p>hello <b>world</b></p>");
    expect(out).toContain("<!doctype html>");
    expect(out).toContain("<p>hello <b>world</b></p>");
    expect(out).toContain("system-ui");
  });

  it("trims surrounding whitespace before deciding", () => {
    expect(buildPreviewDoc("  <!DOCTYPE HTML><html></html>  ")).toBe(
      "<!DOCTYPE HTML><html></html>",
    );
  });

  it("never injects the fragment outside the body", () => {
    const out = buildPreviewDoc("<script>void 0;</script>");
    expect(out.indexOf("<script>")).toBeGreaterThan(out.indexOf("<body>"));
  });
});

describe("binaryViewKind", () => {
  it("maps the whitelisted suffixes only", () => {
    expect(binaryViewKind("a.pdf")).toBe("pdf");
    expect(binaryViewKind("a.PNG")).toBe("image"); // case-insensitive
    expect(binaryViewKind("a.jpg")).toBe("image");
    expect(binaryViewKind("a.jpeg")).toBe("image");
    expect(binaryViewKind("a.gif")).toBe("image");
    expect(binaryViewKind("a.webp")).toBe("image");
  });

  it("returns null for everything else — text stays on the shiki path", () => {
    expect(binaryViewKind("a.md")).toBeNull();
    expect(binaryViewKind("a.txt")).toBeNull();
    expect(binaryViewKind("a.svg")).toBeNull();
    expect(binaryViewKind("a.html")).toBeNull();
    expect(binaryViewKind("a")).toBeNull();
    expect(binaryViewKind("")).toBeNull();
  });
});

describe("filePreviewUrl", () => {
  it("encodes the path for the read-only route", () => {
    expect(filePreviewUrl("a b/c.png")).toBe(`/api/file?path=${encodeURIComponent("a b/c.png")}`);
    expect(filePreviewUrl("x.pdf")).toContain("x.pdf");
  });
});
