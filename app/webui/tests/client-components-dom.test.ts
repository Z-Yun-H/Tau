/**
 * Component-level DOM tests for the extracted surfaces (issue #151):
 * ConversationStream (the chat content column) and ModalLayer (the
 * overlay switch), rendered by the REAL built client in headless
 * Chromium against the REAL server — the same harness as
 * client-snapshot.test.ts (skips when no browser is installed).
 *
 * These complement the byte-level snapshots: snapshots pin STRUCTURE,
 * these pin the extracted components' BEHAVIOR — modal open/close via
 * keyboard, card rendering after a plan round, and the autoscroll follow
 * (the stream column scrolls itself, the page never does).
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
let page: Page;

beforeAll(async () => {
  if (EXECUTABLE) {
    browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--no-sandbox"] });
  }
});

afterAll(async () => {
  await browser?.close();
});

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-webui-components-"));
  process.env["TAU_WEBUI_QUIET"] = "1";
  process.env.TAU_HOME = path.join(tmp, "home");
  fs.mkdirSync(tauHome(), { recursive: true });
  process.chdir(tmp);
  ui = await startWebUi({ port: 0 });
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(ui.url, { waitUntil: "networkidle" });
  await page.waitForSelector("textarea", { timeout: 15_000 });
});

afterEach(async () => {
  await ui.close();
  await page.close().catch(() => {});
  process.chdir(ORIGINAL_CWD);
  delete process.env["TAU_WEBUI_QUIET"];
  delete process.env.TAU_HOME;
  fs.rmSync(tmp, { recursive: true, force: true });
});

suite("WebUI client — extracted components (issue #151)", () => {
  it(
    "ModalLayer: Ctrl+, opens settings, ? opens shortcuts, Esc closes both",
    { timeout: 60_000 },
    async () => {
      // settings via the keyboard contract
      await page.keyboard.press("Control+,");
      await page.waitForSelector('[role="dialog"][aria-label="settings"]', { timeout: 5_000 });
      // Esc closes the open overlay
      await page.keyboard.press("Escape");
      await page.waitForSelector('[role="dialog"][aria-label="settings"]', {
        state: "detached",
        timeout: 5_000,
      });

      // shortcuts via "?" — the contract requires an EMPTY focused composer
      await page.focus("textarea");
      await page.keyboard.press("?");
      await page.waitForSelector('[role="dialog"][aria-label="shortcuts"]', {
        timeout: 5_000,
      });
      // both flags independent — settings opens on top of shortcuts
      await page.keyboard.press("Control+,");
      await page.waitForSelector('[role="dialog"][aria-label="settings"]', { timeout: 5_000 });
      // one Esc closes both (closeOverlays)
      await page.keyboard.press("Escape");
      await page.waitForSelector('[role="dialog"]', { state: "detached", timeout: 5_000 });
    },
  );

  it(
    "ConversationStream: user bubble → plan card → result card render in the stream column",
    { timeout: 90_000 },
    async () => {
      await page.fill("textarea", "find all *.md files");
      await page.keyboard.press("Enter");

      // the user bubble renders inside ConversationStream
      await page.getByText("find all *.md files").first().waitFor({ timeout: 10_000 });
      // the reviewed plan card lands (mock provider plans instantly)
      await page.getByText("Run plan").first().waitFor({ timeout: 20_000 });

      // run it — the result card is the authoritative terminal view
      await page.getByText("Run plan").first().click();
      await page.getByText("file.find in").first().waitFor({ timeout: 30_000 });

      const classes = await page.evaluate(() => ({
        rows: document.querySelectorAll(".user-row").length,
        stream: document.querySelectorAll(".stream-scroll").length,
      }));
      expect(classes.rows).toBe(1);
      expect(classes.stream).toBe(1);
    },
  );

  it(
    "ConversationStream autoscroll: the stream column follows new output",
    { timeout: 60_000 },
    async () => {
      // Fill the stream far past the fold, then send one more turn — the
      // follow watcher must bring the newest card into view INSIDE the
      // stream column (the page itself never scrolls — viewport-lock).
      await page.evaluate(() => {
        const inner = document.querySelector<HTMLElement>(".stream-inner");
        if (!inner) throw new Error(".stream-inner not found");
        for (let i = 0; i < 30; i++) {
          const row = document.createElement("div");
          row.className = "user-row";
          row.innerHTML = `<div class="user-col"><div class="user-bubble">filler ${i}</div></div>`;
          inner.appendChild(row);
        }
      });
      await page.evaluate(() => {
        const stream = document.querySelector<HTMLElement>(".stream-scroll");
        if (stream) stream.scrollTop = 0; // start scrolled UP, away from the fold
      });

      await page.fill("textarea", "one more");
      await page.keyboard.press("Enter");
      await page.getByText("one more").last().waitFor({ timeout: 10_000 });

      // the follow watcher fires on card-count change (debounced watchers
      // settle within a beat) — the stream scrolls down, the page does not.
      await page.waitForFunction(
        () => {
          const stream = document.querySelector<HTMLElement>(".stream-scroll");
          if (!stream) return false;
          return stream.scrollTop > 0;
        },
        { timeout: 10_000 },
      );
      const pageScroll = await page.evaluate(
        () =>
          (document.scrollingElement as HTMLElement).scrollHeight -
          (document.scrollingElement as HTMLElement).clientHeight,
      );
      expect(pageScroll).toBeLessThanOrEqual(0);
    },
  );
});
