/**
 * GET /api/file — the read-only workspace file-preview route (issue #136):
 * containment (escapesWorkspace / isSystemWritePath / realpath), the
 * conservative mime whitelist (never executable content), size cap, and
 * the exact status semantics (400/403/404/413). Plus the client/server
 * parity lock: every extension the client's binaryViewKind() can name MUST
 * be servable by the server.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tauHome } from "@tau/core";
import { resetProviders, registerProviderBuiltins } from "@tau/ai";
import { startWebUi, FILE_PREVIEW_MIME } from "../src/server.js";
import type { RunningWebUi } from "../src/server.js";
import { binaryViewKind } from "../client/lib/preview.js";

const ORIGINAL_CWD = process.cwd();
let tmp = "";
let ui: RunningWebUi;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-file-"));
  process.env["TAU_WEBUI_QUIET"] = "1";
  process.env.TAU_HOME = path.join(tmp, "home");
  fs.mkdirSync(tauHome(), { recursive: true });
  process.chdir(tmp);
  registerProviderBuiltins();
  ui = await startWebUi({ port: 0 });
});

afterEach(async () => {
  await ui.close();
  process.chdir(ORIGINAL_CWD);
  delete process.env["TAU_WEBUI_QUIET"];
  delete process.env.TAU_HOME;
  fs.rmSync(tmp, { recursive: true, force: true });
  resetProviders();
  registerProviderBuiltins();
});

const get = (path_ = "/api/file", query = ""): Promise<Response> =>
  fetch(new URL(`${path_}${query}`, ui.url));

describe("GET /api/file", () => {
  it("requires a path parameter", async () => {
    const res = await get("/api/file");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("path");
  });

  it("streams a png with the native content type + nosniff + inline disposition", async () => {
    const bytes = Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0,
      2, 0, 0, 0, 3,
    ]);
    fs.writeFileSync(path.join(tmp, "shot.png"), bytes);
    const res = await get("/api/file", `?path=${encodeURIComponent("shot.png")}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-disposition")).toContain('inline; filename="shot.png"');
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body).toEqual(bytes);
  });

  it("serves pdf and plain text from the whitelist", async () => {
    fs.writeFileSync(path.join(tmp, "doc.pdf"), Buffer.from("%PDF-1.4 fake"));
    fs.writeFileSync(path.join(tmp, "notes.md"), Buffer.from("# notes"));
    const pdf = await get("/api/file", `?path=${encodeURIComponent("doc.pdf")}`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    const md = await get("/api/file", `?path=${encodeURIComponent("notes.md")}`);
    expect(md.status).toBe(200);
    expect(md.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  });

  it("answers 403 for paths escaping the workspace (relative and absolute)", async () => {
    fs.writeFileSync(path.join(tmp, "ok.txt"), "ok");
    const climb = await get("/api/file", `?path=${encodeURIComponent("../x.txt")}`);
    expect(climb.status).toBe(403);
    expect(((await climb.json()) as { error: string }).error).toContain("escapes the workspace");

    const abs = await get("/api/file", `?path=${encodeURIComponent("/etc/hostname")}`);
    expect(abs.status).toBe(403);
    expect(((await abs.json()) as { error: string }).error).toContain("escapes the workspace");
  });

  it("answers 403 for a symlink that points outside the workspace", async () => {
    fs.symlinkSync("/etc/hostname", path.join(tmp, "evil.txt"));
    const res = await get("/api/file", `?path=${encodeURIComponent("evil.txt")}`);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toContain("escapes the workspace");
  });

  it("never serves executable/scriptable types", async () => {
    for (const name of ["page.html", "script.js", "vector.svg", "styles.css", "run.exe"]) {
      fs.writeFileSync(path.join(tmp, name), "x");
      const res = await get("/api/file", `?path=${encodeURIComponent(name)}`);
      expect(res.status, name).toBe(403);
      expect(((await res.json()) as { error: string }).error).toContain("not previewable");
    }
  });

  it("answers 404 for missing files and directories", async () => {
    const missing = await get("/api/file", `?path=${encodeURIComponent("nope.txt")}`);
    expect(missing.status).toBe(404);

    fs.mkdirSync(path.join(tmp, "dir"));
    const dir = await get("/api/file", `?path=${encodeURIComponent("dir")}`);
    expect(dir.status).toBe(404);
    expect(((await dir.json()) as { error: string }).error).toContain("not a file");
  });

  it("answers 413 over the size cap", async () => {
    fs.writeFileSync(path.join(tmp, "big.png"), Buffer.alloc(8 * 1024 * 1024 + 1));
    const res = await get("/api/file", `?path=${encodeURIComponent("big.png")}`);
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toContain("too large");
  });
});

describe("client/server preview parity (issue #136)", () => {
  it("every client-viewable extension is servable by the server whitelist", () => {
    const clientExts = ["pdf", "png", "jpg", "jpeg", "gif", "webp"];
    for (const ext of clientExts) {
      expect(FILE_PREVIEW_MIME[`.${ext}`], ext).toBeTruthy();
      expect(binaryViewKind(`x.${ext}`)).not.toBeNull();
    }
    // and nothing the client treats as text binary-sniffs as a view
    expect(binaryViewKind("x.txt")).toBeNull();
    expect(binaryViewKind("x.md")).toBeNull();
    expect(binaryViewKind("x.html")).toBeNull();
    expect(binaryViewKind("x.svg")).toBeNull();
  });
});
