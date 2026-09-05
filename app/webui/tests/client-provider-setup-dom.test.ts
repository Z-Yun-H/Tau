/**
 * ProviderSetup DOM test (issue #152) — the settings provider-setup flow
 * end-to-end against the REAL server in headless Chromium (same harness
 * as client-snapshot.test.ts; skips when no browser is installed):
 *
 * - the settings modal renders the server-sent provider catalog;
 * - picking a provider prefills the endpoint (the lookup — users never
 *   type model API URLs);
 * - the key input is type=password (防窥) and the show toggle re-masks;
 * - saving persists through the real POST /api/config/provider and the
 *   saved state re-renders MASKED (sk-***last4), input cleared, never
 *   echoing plaintext.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { configPath, loadConfig, tauHome } from "@tau/core";
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
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-webui-setup-"));
  process.env["TAU_WEBUI_QUIET"] = "1";
  process.env.TAU_HOME = path.join(tmp, "home");
  fs.mkdirSync(tauHome(), { recursive: true });
  process.chdir(tmp);
  ui = await startWebUi({ port: 0 });
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(ui.url, { waitUntil: "networkidle" });
  await page.waitForSelector("textarea", { timeout: 15_000 });
  // open settings via the keyboard contract
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

suite("WebUI client — ProviderSetup flow (issue #152)", () => {
  it(
    "catalog renders, endpoint prefills, key input is masked, save persists and re-renders masked",
    { timeout: 90_000 },
    async () => {
      const dialog = page.locator('[role="dialog"][aria-label="settings"]');

      // The catalog chips render (server-sent, one per registered provider).
      await dialog.locator('button:has-text("deepseek")').waitFor({ timeout: 10_000 });
      expect(await dialog.locator(".provider-option").count()).toBeGreaterThanOrEqual(6);

      // Pick deepseek — the endpoint looks itself up.
      await dialog.locator('button:has-text("deepseek")').first().click();
      await dialog.locator(".setup-rows").filter({ hasText: "https://api.deepseek.com" }).waitFor({
        timeout: 5_000,
      });
      // Console link where the key comes from.
      await dialog.locator(".console-link").filter({ hasText: "get a deepseek key" }).waitFor({
        timeout: 5_000,
      });

      // The key input is a PASSWORD field — masked by default (防窥).
      const keyInput = dialog.locator('input[aria-label="api key"]');
      await keyInput.fill("sk-test-deepseek-abcdef123456");
      expect(await keyInput.getAttribute("type")).toBe("password");

      // The show toggle reveals it, then auto re-masks after 8s.
      await dialog.locator('button:has-text("show")').click();
      expect(await keyInput.getAttribute("type")).toBe("text");
      await page.waitForTimeout(8_600);
      expect(await keyInput.getAttribute("type")).toBe("password");

      // Save — plaintext rides the request, the UI clears it immediately.
      await dialog.locator('button:has-text("save")').click();
      await dialog
        .locator(".setup-ok")
        .filter({ hasText: "key saved" })
        .waitFor({ timeout: 10_000 });
      expect(await keyInput.inputValue()).toBe("");

      // The saved row shows the SERVER's mask, never plaintext…
      const dialogText = await dialog.textContent();
      expect(dialogText).not.toContain("sk-test-deepseek-abcdef123456");
      await dialog.locator(".setup-rows").filter({ hasText: "***" }).waitFor({ timeout: 5_000 });

      // …and the key really persisted (owner-only config file).
      expect(loadConfig().providers.deepseek?.apiKey).toBe("sk-test-deepseek-abcdef123456");
      const mode = fs.statSync(configPath()).mode & 0o777;
      expect(mode).toBe(0o600);
    },
  );

  it(
    "keyless providers hide the key input and show the provider's note",
    { timeout: 60_000 },
    async () => {
      const dialog = page.locator('[role="dialog"][aria-label="settings"]');
      await dialog.locator('button:has-text("ollama")').first().click();
      await dialog.locator(".setup-rows").filter({ hasText: "http://localhost:11434" }).waitFor({
        timeout: 5_000,
      });
      expect(await dialog.locator('input[aria-label="api key"]').count()).toBe(0);
      await dialog.locator(".section-hint").filter({ hasText: "runs locally" }).waitFor({
        timeout: 5_000,
      });
    },
  );
});
