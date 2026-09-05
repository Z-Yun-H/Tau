/**
 * Viewport-lock layout contract (issue #150): the page's TOTAL height is
 * always the viewport — never the sum of its parts. Inner columns own the
 * scrolling: the conversation stream on every breakpoint, the reference
 * rail beneath it on narrow screens. The real built client runs in
 * headless Chromium against the real server (`startWebUi`) over real
 * HTTP, mirroring client-snapshot.test.ts's harness. When no browser is
 * available (e.g. the CI runner, which installs none) the suite SKIPS.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { tauHome } from "@tau/core";
import { startWebUi } from "../src/server.js";
import type { RunningWebUi } from "../src/server.js";

/** Same resolution order as scripts/screenshot.mjs — no downloads, ever. */
function resolveChromium(): string | undefined {
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

const EXECUTABLE = resolveChromium();
const suite = EXECUTABLE ? describe : describe.skip;

const ORIGINAL_CWD = process.cwd();
let tmp = "";
let ui: RunningWebUi;
let browser: Browser;
let pages: Page[] = [];

/** The three layout breakpoints of the design contract. */
const BREAKPOINTS = [
  { name: "lg-1440", width: 1440, height: 900 },
  { name: "md-900", width: 900, height: 900 },
  { name: "sm-390", width: 390, height: 844 },
] as const;

beforeAll(async () => {
  if (EXECUTABLE) {
    browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--no-sandbox"] });
  }
});

afterAll(async () => {
  await browser?.close();
});

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-webui-viewport-"));
  process.env["TAU_WEBUI_QUIET"] = "1";
  process.env.TAU_HOME = path.join(tmp, "home");
  fs.mkdirSync(tauHome(), { recursive: true });
  process.chdir(tmp);
  ui = await startWebUi({ port: 0 });
});

afterEach(async () => {
  await ui.close();
  for (const page of pages) await page.close().catch(() => {});
  pages = [];
  process.chdir(ORIGINAL_CWD);
  delete process.env["TAU_WEBUI_QUIET"];
  delete process.env.TAU_HOME;
  fs.rmSync(tmp, { recursive: true, force: true });
});

interface Metrics {
  bodyOverflowY: string;
  /** scrollingElement.scrollHeight − clientHeight: > 0 means the PAGE scrolls. */
  pageScrollable: number;
  viewportH: number;
  bodyH: number;
  streamOverflowY: string;
  streamScrollable: number;
  composerBottom: number;
}

async function metrics(page: Page): Promise<Metrics> {
  return page.evaluate(() => {
    const se = document.scrollingElement as HTMLElement | null;
    const stream = document.querySelector<HTMLElement>(".stream-scroll");
    const composer = document.querySelector<HTMLElement>(".composer-dock");
    return {
      bodyOverflowY: getComputedStyle(document.body).overflowY,
      pageScrollable: se ? se.scrollHeight - se.clientHeight : -1,
      viewportH: window.innerHeight,
      bodyH: Math.round(document.body.getBoundingClientRect().height),
      streamOverflowY: stream ? getComputedStyle(stream).overflowY : "none",
      streamScrollable: stream ? stream.scrollHeight - stream.clientHeight : -1,
      composerBottom: composer ? Math.round(composer.getBoundingClientRect().bottom) : -1,
    };
  });
}

suite("WebUI client — viewport-lock layout contract (issue #150)", () => {
  it(
    "page height stays the viewport at every breakpoint; only inner columns scroll",
    { timeout: 180_000 },
    async () => {
      for (const bp of BREAKPOINTS) {
        const page = await browser.newPage({ viewport: { width: bp.width, height: bp.height } });
        pages.push(page);
        await page.goto(ui.url, { waitUntil: "networkidle" });
        await page.waitForSelector("textarea", { timeout: 15_000 });

        // Resting state: body is overflow hidden and exactly viewport tall;
        // the page itself cannot scroll; the stream is the scroll owner.
        const rest = await metrics(page);
        expect(rest.bodyOverflowY, `${bp.name}: body overflow-y`).toBe("hidden");
        expect(
          Math.abs(rest.bodyH - rest.viewportH),
          `${bp.name}: body height == viewport height`,
        ).toBeLessThanOrEqual(1);
        expect(rest.pageScrollable, `${bp.name}: page must not scroll`).toBeLessThanOrEqual(0);
        expect(rest.streamOverflowY, `${bp.name}: stream is the scroll container`).toBe("auto");

        // Content grows far beyond the fold (a simulated long conversation —
        // appended as plain DOM so this stays a layout-contract test, not an
        // app-behavior test): the page STILL must not scroll…
        await page.evaluate(() => {
          const inner = document.querySelector<HTMLElement>(".stream-inner");
          if (!inner) throw new Error(".stream-inner not found");
          for (let i = 0; i < 40; i++) {
            const row = document.createElement("div");
            row.className = "user-row";
            row.innerHTML = `<div class="user-col"><div class="user-bubble">filler row ${i} — long enough to force overflow past the fold</div></div>`;
            inner.appendChild(row);
          }
        });
        const grown = await metrics(page);
        expect(
          grown.pageScrollable,
          `${bp.name}: page height must not follow content growth`,
        ).toBeLessThanOrEqual(0);
        expect(
          grown.streamScrollable,
          `${bp.name}: the stream column owns the overflow`,
        ).toBeGreaterThan(0);

        // …and on narrow screens the composer stays visible inside the viewport.
        if (bp.width < 1024) {
          expect(
            grown.composerBottom,
            `${bp.name}: composer bottom edge inside the viewport`,
          ).toBeLessThanOrEqual(grown.viewportH);
          expect(grown.composerBottom).toBeGreaterThan(0);
        }
      }
    },
  );
});
