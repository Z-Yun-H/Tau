/**
 * SettingsPanel DOM test (issue #164) — the model & thinking selection
 * controls end-to-end against the REAL server in headless Chromium (same
 * harness as client-provider-setup-dom.test.ts; skips when no browser):
 *
 * - the model row renders a catalog-backed select (mock's deterministic
 *   offline catalog) with the refresh button;
 * - picking a model persists through the real POST /api/config/model and
 *   the row re-renders from the redacted payload;
 * - the thinking block renders only what the active provider supports:
 *   mock (no knobs) shows the honest "no thinking knobs" note; after
 *   switching to anthropic the mode + effort controls appear and writing
 *   through them persists via POST /api/config/thinking.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { loadConfig, tauHome } from "@tau/core";
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
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-webui-selection-dom-"));
  process.env["TAU_WEBUI_QUIET"] = "1";
  process.env.TAU_HOME = path.join(tmp, "home");
  fs.mkdirSync(tauHome(), { recursive: true });
  process.chdir(tmp);
  ui = await startWebUi({ port: 0 });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(ui.url, { waitUntil: "networkidle" });
  await page.waitForSelector("textarea", { timeout: 15_000 });
  await page.keyboard.press("Control+,");
  await page.waitForSelector('[role="dialog"][aria-label="settings"]', { timeout: 10_000 });
});

afterEach(async () => {
  await ui.close();
  await page.close().catch(() => {});
  process.chdir(ORIGINAL_CWD);
  delete process.env["TAU_WEBUI_QUIET"];
  delete process.env.TAU_HOME;
  fs.rmSync(tmp, { recursive: true, force: true });
});

suite("WebUI client — model & thinking selection (issue #164)", () => {
  it(
    "model select serves the catalog and persists a choice through POST /api/config/model",
    { timeout: 90_000 },
    async () => {
      const dialog = page.locator('[role="dialog"][aria-label="settings"]');

      // The select is catalog-backed (mock's deterministic offline catalog).
      const select = dialog.locator('select[aria-label="model"]');
      await select.waitFor({ state: "visible", timeout: 10_000 });
      await page.waitForFunction(
        () => {
          const el = document.querySelector(
            'select[aria-label="model"]',
          ) as HTMLSelectElement | null;
          const values = el ? [...el.options].map((o) => o.value) : [];
          return values.includes("mock-chat") && values.includes("mock-reasoner");
        },
        { timeout: 10_000 },
      );

      // Pick a model — the write goes through the real endpoint; the panel
      // re-renders from the server's redacted payload once the POST lands.
      await dialog.locator('select[aria-label="model"]').selectOption("mock-reasoner");
      await page.waitForFunction(
        () =>
          (document.querySelector('select[aria-label="model"]') as HTMLSelectElement)?.value ===
          "mock-reasoner",
        { timeout: 10_000 },
      );
      expect(loadConfig().providers["mock"]?.["model"]).toBe("mock-reasoner");
    },
  );

  it(
    "thinking controls render capability-driven and persist through POST /api/config/thinking",
    { timeout: 90_000 },
    async () => {
      const dialog = page.locator('[role="dialog"][aria-label="settings"]');

      // mock has no knobs — the honest note renders, no controls.
      await dialog.locator(".thinking-picker").waitFor({ timeout: 10_000 });
      expect(await dialog.locator(".mini-picker").count()).toBe(0);
      expect(await dialog.locator(".thinking-picker .row-meta").textContent()).toContain(
        "no thinking knobs",
      );

      // Switch the active provider to anthropic (needs no key to switch).
      await dialog.locator('button:has-text("anthropic")').first().click();
      await dialog.locator(".save-row button").filter({ hasText: "save" }).click();
      // The thinking block re-renders with mode + effort controls.
      await dialog.locator(".mini-picker[aria-label='thinking mode']").waitFor({ timeout: 15_000 });
      await dialog
        .locator(".mini-picker[aria-label='thinking effort']")
        .waitFor({ timeout: 5_000 });

      // Write: on + high → persists through the real endpoint.
      await dialog
        .locator(".mini-picker[aria-label='thinking mode'] button:has-text('on')")
        .click();
      await dialog
        .locator(".mini-picker[aria-label='thinking effort'] button:has-text('high')")
        .waitFor({ timeout: 10_000 });
      await dialog
        .locator(".mini-picker[aria-label='thinking effort'] button:has-text('high')")
        .click();
      // The server's redacted payload re-renders: high is highlighted.
      await page.waitForFunction(
        () =>
          document
            .querySelector(".mini-picker[aria-label='thinking effort'] .on")
            ?.textContent?.trim() === "high",
        { timeout: 10_000 },
      );
      const entry = loadConfig().providers["anthropic"];
      expect(entry?.["thinking"]).toBe("on");
      expect(entry?.["thinkingEffort"]).toBe("high");
    },
  );
});
