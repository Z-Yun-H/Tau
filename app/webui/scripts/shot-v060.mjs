/**
 * WebUI v0.6.0 feature captures — real server + real client in headless
 * Chromium, mirroring scripts/screenshot.mjs's approach (mock provider,
 * TAU_HOME sandbox, offline, fixtures generated in-code). Saves PNGs for
 * the v0.6.0 features under docs/screenshots/:
 *
 *   command-menu.png          U3 — composer '/' floating menu (full catalog)
 *   command-menu-filter.png   U3 — typed filter narrows the menu ('th' -> theme)
 *   attachments.png           U5 — composer attachment chips (magic-number-gated)
 *   attachments-sent.png      U5 — sent user card + plan review with chips
 *   html-preview.png          U6 — result card sandboxed html block preview
 *   image-view.png            U6 — agent goal ToolCallCard native image view
 *   image-viewer-card.png     U6 — the image viewer card, element-cropped
 *   pdf-view.png              U6 — native pdf embed (best effort: headless
 *                             Chromium usually lacks the internal viewer; the
 *                             scene then captures the honest fallback card)
 *
 * The U4 evidence (request payloads carrying prior turns) is reported on
 * stdout — PR evidence, not a doc asset.
 *
 * Run (from the repo root):
 *   pnpm install                      # playwright-core comes from the catalog
 *   pnpm --filter @tau/webui build    # the client must be built first
 *   pnpm --filter @tau/webui shots:v060
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { startWebUi } from "../src/server.js";

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../docs/screenshots");
const ORIGINAL_CWD = process.cwd();

/** Resolve a Chromium executable without downloading anything. */
function resolveChromium() {
  if (process.env.TAU_CHROMIUM) return process.env.TAU_CHROMIUM;
  const cache = path.join(os.homedir(), ".cache", "ms-playwright");
  if (fs.existsSync(cache)) {
    const builds = fs
      .readdirSync(cache)
      .filter((name) => /^chromium-\d+$/.test(name))
      .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    for (const build of builds) {
      for (const entry of ["chrome-linux/chrome", "chrome-linux64/chrome", "chrome-mac/Chromium"]) {
        const candidate = path.join(cache, build, entry);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return undefined;
}

/** CRC32 (PNG chunk checksums) — canonical bitwise implementation. */
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Minimal but valid PNG (RGB8, indigo->violet diagonal gradient) — the image fixture. */
function makePosterPng(width = 240, height = 180) {
  const chunk = (type, data) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let off = 0;
  for (let y = 0; y < height; y++) {
    raw[off++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const t = (x + y) / (width + height);
      raw[off++] = Math.round(79 + (147 - 79) * t); // #4f46e5 -> #9333ea
      raw[off++] = Math.round(70 + (51 - 70) * t);
      raw[off++] = Math.round(229 + (234 - 229) * t);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Minimal single-page PDF with a correct xref table — the pdf fixture. */
function makeSpecPdf() {
  const content = "BT /F1 18 Tf 28 96 Td (Tau v0.6.0 - spec fixture) Tj ET";
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 260 150]/Resources<</Font<</F1 4 0 R>>>>/Contents 5 0 R>>",
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    `<</Length ${content.length}>>stream\n${content}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets = [];
  for (const [i, body] of objects.entries()) {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  }
  const startxref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${startxref}\n%%EOF\n`;
  return out;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-webui-shots-v060-"));
process.env.TAU_HOME = path.join(tmp, "home");
fs.mkdirSync(process.env.TAU_HOME, { recursive: true });
fs.writeFileSync(
  path.join(tmp, "readme.md"),
  ["# demo workspace", "", "fixture workspace for the v0.6.0 shots", ""].join("\n"),
);
fs.writeFileSync(path.join(tmp, "poster.png"), makePosterPng());
fs.writeFileSync(path.join(tmp, "spec.pdf"), makeSpecPdf());
process.chdir(tmp);

const priorTurnsEvidence = [];
const ui = await startWebUi({ port: 0 });
const browser = await chromium.launch({
  executablePath: resolveChromium(),
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
  });
  // U4 evidence: record every /api POST carrying prior turns. The client's
  // wire field is `history` (readPriorTurns sanitizes it server-side into
  // PlanningContext.priorTurns — 12 turns / 4000 chars caps).
  page.on("request", (req) => {
    if (req.method() !== "POST" || !req.url().includes("/api/")) return;
    try {
      const body = req.postDataJSON();
      if (body && Array.isArray(body.history)) {
        priorTurnsEvidence.push({
          path: new URL(req.url()).pathname,
          intent: String(body.intent ?? "").slice(0, 80),
          priorTurnsCount: body.history.length,
          firstPriorTurn: body.history[0] ? JSON.stringify(body.history[0]).slice(0, 160) : null,
          attachments: Array.isArray(body.attachments) ? body.attachments.length : undefined,
        });
      }
    } catch {
      /* non-JSON body — not a prior-turns carrier */
    }
  });

  await page.goto(ui.url, { waitUntil: "networkidle" });
  await page.waitForSelector("textarea", { timeout: 15_000 });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // ---- U3: composer '/' command menu ---------------------------------------
  await page.click("textarea");
  await page.keyboard.type("/");
  await page.waitForSelector(".slash-menu", { timeout: 10_000 });
  await page.waitForTimeout(400); // entrance animation settle
  await page.screenshot({ path: path.join(OUT_DIR, "command-menu.png") });

  await page.keyboard.type("th"); // narrows to /theme
  await page.waitForTimeout(350);
  await page.screenshot({ path: path.join(OUT_DIR, "command-menu-filter.png") });

  await page.keyboard.press("Escape"); // close menu (buffer keeps '/')
  await page.fill("textarea", "");

  // ---- U5: attachment chips in the composer --------------------------------
  await page.setInputFiles('input[type="file"]', path.join(tmp, "poster.png"));
  await page.waitForSelector(".attach-chip", { timeout: 10_000 });
  await page.waitForTimeout(400); // thumbnail decode settle
  await page.screenshot({ path: path.join(OUT_DIR, "attachments.png") });

  await page.click("textarea");
  await page.keyboard.type("What does this poster look like?");
  await page.keyboard.press("Enter");
  await page.getByText("Run plan").first().waitFor({ timeout: 20_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT_DIR, "attachments-sent.png") });

  // ---- U6: sandboxed html block preview in the result card -----------------
  // The offline mock never emits html fences (tool output is a numbered line
  // viewer; the answer is a single marker tail) — the preview is a
  // real-provider surface. THIS ONE scene intercepts the execute stream and
  // injects a payload carrying an ```html block; the shipped client pipeline
  // (renderMarkdown -> attachHtmlPreviews -> sandboxed iframe) then runs for
  // real. Every other scene is fully real end-to-end; docs label this one as
  // a stream harness.
  await page.keyboard.press("Alt+n");
  await page.waitForTimeout(400);
  await page.route("**/api/execute/stream", async (route) => {
    const output = [
      "Here is the card you asked for:",
      "",
      "```html",
      '<div style="padding:28px;border-radius:14px;background:linear-gradient(135deg,#4f46e5,#9333ea);color:#fff;font-family:system-ui,sans-serif;max-width:520px">',
      '  <h1 style="margin:0 0 10px;font-size:26px">Tau v0.6.0</h1>',
      '  <p style="margin:0;font-size:15px;opacity:.92">Sandboxed preview — rendered inside an <b>opaque-origin iframe</b>.</p>',
      "</div>",
      "```",
      "",
    ].join("\n");
    const lines = [
      JSON.stringify({ type: "step_output", chunk: output }),
      JSON.stringify({ type: "step_end", ok: true }),
      JSON.stringify({ type: "result", status: "ok", output, outcomes: [{ ok: true }] }),
    ];
    await route.fulfill({
      status: 200,
      headers: { "content-type": "application/x-ndjson; charset=utf-8" },
      body: lines.join("\n") + "\n",
    });
  });
  await page.fill("textarea", "make a status card");
  await page.keyboard.press("Enter");
  await page.getByText("Run plan").last().waitFor({ timeout: 20_000 });
  await page.getByText("Run plan").last().click();
  await page.locator(".html-preview").first().waitFor({ timeout: 15_000 });
  await page.locator(".html-preview button").first().click();
  await page.locator(".html-preview iframe").first().waitFor({ timeout: 10_000 });
  await page.waitForTimeout(800); // iframe render settle
  await page.unroute("**/api/execute/stream");
  await page.evaluate(() => {
    document.querySelector(".stream-scroll")?.scrollTo({ top: 1e9, behavior: "instant" });
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT_DIR, "html-preview.png") });

  // ---- U6: native image view in an agent goal (same thread: the goal
  // request now carries this thread's prior turns — U4 evidence).
  // The readTool refuses BINARY content by design, so the mock rounds on
  // (repair echo + continue probe + round cap) — the viewer card itself
  // streams the real bytes through /api/file regardless. Frame the shot on
  // the R1 viewer: scroll it into view, then also crop the card itself.
  const agentScene = async () => {
    await page.getByRole("button", { name: "agent", exact: true }).first().click();
    await page.click("textarea");
    await page.fill("textarea", "read poster.png");
    await page.keyboard.press("Enter");
    await page.locator(".viewer-img").first().waitFor({ timeout: 45_000 });
  };
  try {
    await agentScene();
  } catch (firstError) {
    // Flake diagnostic: dump the stream + goal responses, then retry once
    // on a fresh thread (the mock's multi-round path is timing-sensitive).
    const dump = await page.evaluate(
      () => document.querySelector(".stream-scroll")?.innerText.slice(0, 600) ?? "NO STREAM",
    );
    console.log("[image-scene retry] first attempt failed:", firstError.message.split("\n")[0]);
    console.log("[image-scene retry] stream dump:", JSON.stringify(dump.slice(0, 300)));
    await page.keyboard.press("Alt+n");
    await page.waitForTimeout(600);
    await agentScene();
  }
  await page.waitForTimeout(1200); // image decode + rounds settle
  await page.locator(".file-viewer").first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT_DIR, "image-view.png") });
  await page
    .locator(".file-viewer")
    .first()
    .screenshot({
      path: path.join(OUT_DIR, "image-viewer-card.png"),
    });

  // ---- U6: native pdf embed in the same agent thread (best effort; the
  // 2nd goal request carries priorTurns — U4 agent-endpoint evidence).
  // Headless Chromium may lack the internal pdf viewer — the card then
  // flips to its honest "preview unavailable — open" fallback, which is
  // still a valid U6 surface to capture.
  const pdfScene = async () => {
    await page.click("textarea");
    await page.fill("textarea", "read spec.pdf");
    await page.keyboard.press("Enter");
    await page.locator(".viewer-embed, .viewer-empty").first().waitFor({ timeout: 45_000 });
  };
  try {
    try {
      await pdfScene();
    } catch (firstError) {
      console.log("[pdf-scene retry] first attempt failed:", firstError.message.split("\n")[0]);
      const dump = await page.evaluate(
        () => document.querySelector(".stream-scroll")?.innerText.slice(0, 400) ?? "NO STREAM",
      );
      console.log("[pdf-scene retry] stream dump:", JSON.stringify(dump.slice(0, 240)));
      await page.keyboard.press("Alt+n");
      await page.waitForTimeout(600);
      await pdfScene();
    }
    await page.waitForTimeout(1200);
    await page.locator(".file-viewer").last().scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT_DIR, "pdf-view.png") });
    await page
      .locator(".file-viewer")
      .last()
      .screenshot({
        path: path.join(OUT_DIR, "pdf-viewer-card.png"),
      });
    console.log("pdf-view captured");
  } catch (error) {
    console.log("pdf-view skipped: " + error.message.split("\n")[0]);
  }

  console.log(`shots written to ${OUT_DIR}`);
  console.log(`priorTurns carriers observed: ${priorTurnsEvidence.length}`);
  console.log(JSON.stringify(priorTurnsEvidence, null, 2));
} finally {
  await browser.close();
  await ui.close();
  process.chdir(ORIGINAL_CWD);
  fs.rmSync(tmp, { recursive: true, force: true });
}
