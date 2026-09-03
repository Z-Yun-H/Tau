/**
 * WebUI client snapshots — the REAL built client in headless Chromium
 * against the REAL server (`startWebUi`) over REAL HTTP, TAU_HOME sandbox,
 * mock provider. The DOM of the stream column is file-snapshotted with
 * volatile fields normalized (sandbox paths, wall-clock thinking seconds),
 * so the snapshots pin what the user's browser actually renders for the
 * v0.5.0 surfaces: the streaming plan card, the thinking disclosure (both
 * states), the result card, and the agent goal card with per-round thinking
 * plus the file.read viewer.
 *
 * Chromium resolution mirrors scripts/screenshot.mjs ($TAU_CHROMIUM →
 * ~/.cache/ms-playwright). When no browser is available (e.g. the CI
 * runner, which installs none) the suite SKIPS — locally it runs and owns
 * the snapshot files. Requires the client build (`pnpm --filter @tau/webui
 * build`) so the server serves the real bundle.
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

/** The readme the agent reads — includes the mock's completion marker so
 * the goal lands done after ONE round (deterministic, screenshot-stable). */
const README = [
  "# demo workspace",
  "",
  "Markdown fixture for the file.read viewer.",
  "",
  "- rendered through shiki with the detected language",
  "- language detection is the tool's own languageForFile",
  "",
  "GOAL_COMPLETE: file viewer ready",
  "",
].join("\n");

beforeAll(async () => {
  if (EXECUTABLE) {
    browser = await chromium.launch({ executablePath: EXECUTABLE, args: ["--no-sandbox"] });
  }
});

afterAll(async () => {
  await browser?.close();
});

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-webui-client-"));
  process.env["TAU_WEBUI_QUIET"] = "1";
  process.env.TAU_HOME = path.join(tmp, "home");
  fs.mkdirSync(tauHome(), { recursive: true });
  process.chdir(tmp);
  fs.writeFileSync(path.join(tmp, "readme.md"), README);
  fs.mkdirSync(path.join(tmp, "docs"));
  fs.writeFileSync(path.join(tmp, "docs", "notes.md"), "- note\n");
  ui = await startWebUi({ port: 0 });
});

afterEach(async () => {
  await ui.close();
  await page?.close().catch(() => {});
  process.chdir(ORIGINAL_CWD);
  delete process.env["TAU_WEBUI_QUIET"];
  delete process.env.TAU_HOME;
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Normalize volatile fields so the DOM snapshots stay portable. */
const normalizeDom = (html: string): string =>
  html
    .replaceAll(tmp, "<sandbox>")
    .replaceAll(os.tmpdir(), "<tmpdir>")
    // The user bubble's tooltip is a wall-clock ISO stamp.
    .replaceAll(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "<ts>")
    // Thinking summary: "Thought" while the duration is still settling,
    // "Thought for Ns" once known — same element either way.
    .replaceAll(/Thought( for \d+s)?/g, "<think-summary>");

const streamHtml = async (): Promise<string> =>
  normalizeDom(await page.locator(".stream-inner").innerHTML());

suite("WebUI client — real browser DOM snapshots", () => {
  it(
    "plan flow: streamed plan card → thinking open → result card",
    { timeout: 120_000 },
    async () => {
      page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto(ui.url, { waitUntil: "networkidle" });
      await page.waitForSelector("textarea", { timeout: 15_000 });

      await page.fill("textarea", "find all *.md files");
      await page.keyboard.press("Enter");
      await page.getByText("Run plan").first().waitFor({ timeout: 20_000 });
      await page.waitForTimeout(500); // let the stream state settle

      // The reviewed plan card with the collapsed thinking disclosure.
      expect(await streamHtml()).toMatchSnapshot("plan-card-with-thinking-collapsed.dom.html");

      // Expanded thinking body — the provider reasoning is one click away.
      await page.locator(".think-head").first().click();
      await page.locator(".think-body").first().waitFor({ timeout: 5_000 });
      expect(await streamHtml()).toMatchSnapshot("thinking-panel-open.dom.html");

      // Run plan → the streaming result card with the file.find output.
      await page.getByText("Run plan").first().click();
      await page.getByText("file.find in").first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(500);
      expect(await streamHtml()).toMatchSnapshot("result-card-after-run.dom.html");
    },
  );

  it(
    "agent mode: goal card with round thinking + file.read viewer",
    { timeout: 120_000 },
    async () => {
      page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto(ui.url, { waitUntil: "networkidle" });
      await page.waitForSelector("textarea", { timeout: 15_000 });

      await page.getByRole("button", { name: "agent", exact: true }).first().click();
      await page.fill("textarea", "read readme.md");
      await page.keyboard.press("Enter");
      // The file.read tool step renders as the structured call card with the
      // shiki-highlighted viewer body — the v0.5.0 inspectable-tool surface.
      await page.locator(".file-viewer").first().waitFor({ timeout: 30_000 });
      await page.locator(".viewer-body").first().waitFor({ timeout: 15_000 });
      await page.getByText("file viewer ready").first().waitFor({ timeout: 30_000 });
      await page.waitForTimeout(600); // shiki + markdown settle
      await page.evaluate(() => {
        window.scrollTo({ top: 0, behavior: "instant" });
        document.querySelector(".stream-scroll")?.scrollTo({ top: 1e9, behavior: "instant" });
      });

      expect(await streamHtml()).toMatchSnapshot("goal-card-with-file-viewer.dom.html");
    },
  );
});
