/**
 * WebUI v0.6.2 feature captures — real server + real client in headless
 * Chromium, mirroring scripts/shot-v061.mjs's approach (mock provider,
 * TAU_HOME sandbox, offline). Saves PNGs for the v0.6.2 model & thinking
 * selection features under docs/screenshots/:
 *
 *   model-picker.png            the settings modal with the provider
 *                               section's catalog-backed model select
 *                               (mock-chat / mock-reasoner served by the
 *                               deterministic offline catalog) and the
 *                               honest "no thinking knobs" note for mock
 *   thinking-controls.png       the provider section, element-cropped,
 *                               anthropic active: capability-driven mode
 *                               (on/off) + effort (low/medium/high)
 *                               mini-pickers with "on (high)" applied —
 *                               persisted through POST /api/config/thinking
 *   thinking-controls-mock.png  the same section with mock active again —
 *                               providers without knobs render the honest
 *                               note instead of dead controls
 *
 * Every scene is real end-to-end — no stream interception: the model
 * choice goes through the actual POST /api/config/model and the thinking
 * writes through POST /api/config/thinking into the TAU_HOME sandbox
 * (0600 config), which is deleted afterwards.
 *
 * Run (from the repo root):
 *   pnpm install                      # playwright-core comes from the catalog
 *   pnpm --filter @tau/webui build    # the client must be built first
 *   pnpm --filter @tau/webui shots:v062
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tau-webui-shots-v062-"));
process.env.TAU_HOME = path.join(tmp, "home");
fs.mkdirSync(process.env.TAU_HOME, { recursive: true });
fs.writeFileSync(
  path.join(tmp, "readme.md"),
  ["# demo workspace", "", "fixture workspace for the v0.6.2 shots", ""].join("\n"),
);
process.chdir(tmp);

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

  await page.goto(ui.url, { waitUntil: "networkidle" });
  await page.waitForSelector("textarea", { timeout: 15_000 });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const settle = async (ms = 350) => page.waitForTimeout(ms);

  // ---- model-picker: the settings modal with the catalog-backed select ----
  await page.getByRole("button", { name: "open settings" }).click();
  await page.waitForSelector('[role="dialog"][aria-label="settings"]', { timeout: 10_000 });
  const dialog = page.locator('[role="dialog"][aria-label="settings"]');
  await settle(500); // let /api/config + /api/models settle

  const select = dialog.locator('select[aria-label="model"]');
  await select.waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForFunction(
    () => {
      const el = document.querySelector('select[aria-label="model"]');
      const values = el ? [...el.options].map((o) => o.value) : [];
      return values.includes("mock-chat") && values.includes("mock-reasoner");
    },
    { timeout: 10_000 },
  );
  // The honest mock note (no thinking knobs) is visible in the same shot.
  await dialog
    .locator(".thinking-picker")
    .filter({ hasText: "no thinking knobs" })
    .waitFor({ timeout: 5_000 });
  await settle(300);
  await page.screenshot({ path: path.join(OUT_DIR, "model-picker.png") });

  // ---- thinking-controls: anthropic active, on + high applied -------------
  await dialog
    .locator(".provider-option")
    .filter({ hasText: /^anthropic/ })
    .click();
  await dialog.locator(".save-row button").filter({ hasText: "save" }).click();
  await page.waitForSelector(".setup-ok", { timeout: 10_000 });
  await dialog.locator(".mini-picker[aria-label='thinking mode']").waitFor({ timeout: 10_000 });
  await dialog.locator(".mini-picker[aria-label='thinking mode'] button:has-text('on')").click();
  await dialog
    .locator(".mini-picker[aria-label='thinking effort'] button:has-text('high')")
    .waitFor({ timeout: 10_000 });
  await dialog
    .locator(".mini-picker[aria-label='thinking effort'] button:has-text('high')")
    .click();
  await page.waitForFunction(
    () =>
      document
        .querySelector(".mini-picker[aria-label='thinking effort'] .on")
        ?.textContent?.trim() === "high",
    { timeout: 10_000 },
  );
  await settle(300);
  await page
    .locator(".settings-section")
    .filter({ has: page.locator('select[aria-label="model"]') })
    .screenshot({ path: path.join(OUT_DIR, "thinking-controls.png") });

  // ---- thinking-controls-mock: knob-less provider, honest note ------------
  await dialog.locator(".provider-option").filter({ hasText: /^mock/ }).click();
  await dialog.locator(".save-row button").filter({ hasText: "save" }).click();
  await page.waitForSelector(".setup-ok", { timeout: 10_000 });
  await dialog
    .locator(".thinking-picker")
    .filter({ hasText: "no thinking knobs" })
    .waitFor({ timeout: 10_000 });
  await settle(300);
  await page
    .locator(".settings-section")
    .filter({ has: page.locator('select[aria-label="model"]') })
    .screenshot({ path: path.join(OUT_DIR, "thinking-controls-mock.png") });

  console.log(`shots written to ${OUT_DIR}`);
} finally {
  await browser.close();
  await ui.close();
  process.chdir(ORIGINAL_CWD);
  fs.rmSync(tmp, { recursive: true, force: true });
}
